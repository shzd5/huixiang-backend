/**
 * 番茄小说 API 服务
 * 直接解析 fanqienovel.com 页面数据 + Cookie 认证
 */
import config from '../config.js'

let cachedCookie = ''

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** 解析可能的小说 ID（兼容 13 位 App ID 和 19 位网页 ID） */
export function parseBookId(input) {
  if (!input?.trim()) return null
  const str = input.trim()
  // 直接是数字
  if (/^\d{13,20}$/.test(str)) return str
  // URL 里提取
  for (const p of [/page\/(\d{13,20})/, /novel\/(\d{13,20})/, /book_id=(\d{13,20})/, /(\d{13,20})/]) {
    const m = str.match(p)
    if (m) return m[1]
  }
  return null
}

/** 从页面 HTML 提取 __INITIAL_STATE__ */
function extractState(html) {
  const m = html.match(/__INITIAL_STATE__\s*=\s*({.*?});\s*\n/)
  if (!m) return null
  try {
    return JSON.parse(m[1])
  } catch {
    return null
  }
}

/** 获取页面数据 */
async function fetchPage(bookId) {
  const resp = await fetch(`https://fanqienovel.com/page/${bookId}`, {
    headers: { 'User-Agent': BROWSER_UA, 'Referer': 'https://fanqienovel.com/' },
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) throw new Error(`页面 ${resp.status}`)
  return extractState(await resp.text())
}

/** 从页面数据提取章节列表 */
function extractChapters(state) {
  const page = state?.page || {}
  let chapters = []

  // 方案1: chapterListWithVolume
  const vols = page.chapterListWithVolume || []
  for (const vol of vols) {
    const list = vol.chapter_list || vol.chapterList || []
    chapters.push(...list)
  }

  // 方案2: chapterList
  if (chapters.length === 0 && page.chapterList?.length > 0) {
    chapters = page.chapterList
  }

  // 方案3: 只有 itemIds
  if (chapters.length === 0 && page.itemIds?.length > 0) {
    chapters = page.itemIds.map((id, i) => ({ item_id: id, title: `第${i + 1}章` }))
  }

  return chapters.map((ch, i) => ({
    itemId: String(ch.item_id || ch.itemId || ch.content_id || ch.id || ''),
    title: ch.title || ch.chapter_name || ch.chapterName || `第${i + 1}章`,
    index: i,
    needPay: ch.needPay ?? ch.need_pay ?? 0,
  })).filter(ch => ch.itemId)
}

/** 获取 Cookie */
async function getCookie() {
  if (cachedCookie) return cachedCookie

  const base = BigInt('1000000000000000000')
  const min = base * BigInt(6)
  const max = base * BigInt(8)
  const start = min + BigInt(Math.floor(Math.random() * Number(max - min)))

  for (let i = start; i < max + base; i += BigInt(Math.floor(Math.random() * 10000) + 1)) {
    try {
      const testCookie = `novel_web_id=${i}`
      const resp = await fetch('https://fanqienovel.com/api/reader/full?itemId=1', {
        headers: { 'User-Agent': BROWSER_UA, 'Cookie': testCookie },
        signal: AbortSignal.timeout(3000),
      })
      if (resp.ok) {
        const text = await resp.text()
        if (text.length > 100) {
          cachedCookie = testCookie
          console.log(`[FanQie] Cookie: ${i.toString().slice(0, 10)}...`)
          return cachedCookie
        }
      }
    } catch {}
    await new Promise(r => setTimeout(r, Math.random() * 100 + 50))
  }
  throw new Error('无法获取 Cookie')
}

/** 获取书籍信息 + 章节列表 */
export async function fetchBookInfo(bookId) {
  try {
    const state = await fetchPage(bookId)
    const page = state?.page || {}
    return {
      bookId,
      title: page.bookName || page.book_name || '未知',
      author: page.author || page.originalAuthors || '未知',
      cover: page.thumbUri || '',
      description: (page.description || page.abstract || '').replace(/<[^>]+>/g, ''),
      wordCount: page.wordNumber || 0,
      status: page.creationStatus || page.status || '',
      chapterTotal: page.chapterTotal || 0,
    }
  } catch (err) {
    console.warn(`[FanQie] fetchBookInfo 失败: ${err.message}`)
    return { bookId, title: `小说${bookId}`, author: '未知', cover: '', description: '', wordCount: 0, status: '', chapterTotal: 0 }
  }
}

/** 获取章节列表 */
export async function fetchCatalog(bookId) {
  const state = await fetchPage(bookId)
  if (!state) throw new Error('无法解析页面数据')
  const chapters = extractChapters(state)
  if (chapters.length === 0) throw new Error('未找到章节列表')
  return chapters
}

/** 获取单章内容 */
export async function fetchChapterContent(itemId) {
  const cookie = await getCookie()
  const resp = await fetch(`https://fanqienovel.com/api/reader/full?itemId=${itemId}`, {
    headers: { 'User-Agent': BROWSER_UA, 'Cookie': cookie },
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) { cachedCookie = ''; throw new Error(`API ${resp.status}`) }

  const data = await resp.json()
  let content = data?.data?.content || data?.content || ''

  return String(content)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>/gi, '').replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n').trim()
}

/** 批量获取章节 */
export async function fetchAllContent(chapters, onProgress) {
  const total = Math.min(chapters.length, config.maxChapters)
  const results = []
  for (let i = 0; i < total; i += config.batchConcurrency) {
    const batch = chapters.slice(i, i + config.batchConcurrency)
    const batchResults = await Promise.all(
      batch.map(async (ch, batchIdx) => {
        const idx = i + batchIdx
        try {
          const content = await fetchChapterContent(ch.itemId)
          onProgress?.(idx + 1, total, ch.title)
          return { index: idx, title: ch.title, itemId: ch.itemId, content, success: true }
        } catch (err) {
          onProgress?.(idx + 1, total, ch.title, true)
          return { index: idx, title: ch.title, itemId: ch.itemId, content: '', success: false, error: err.message }
        }
      })
    )
    results.push(...batchResults)
    if (i + config.batchConcurrency < total) await new Promise(r => setTimeout(r, config.requestDelay))
  }
  return results.sort((a, b) => a.index - b.index)
}

/** 合并文本 */
export function mergeToText(results, bookInfo) {
  return `《${bookInfo.title}》\n作者：${bookInfo.author}\n\n` +
    results.map(ch =>
      ch.success ? `第 ${ch.index + 1} 章 ${ch.title}\n${ch.content}` : `第 ${ch.index + 1} 章 ${ch.title}\n[内容获取失败]`
    ).join('\n\n')
}
