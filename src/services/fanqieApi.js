/**
 * 番茄小说 API 服务
 * 直接调用番茄小说官方接口 + Cookie 认证
 * 不需要第三方代理
 */
import config from '../config.js'

// Cookie 缓存
let cachedCookie = ''
let cookieAttempts = 0

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://fanqienovel.com/',
  'Origin': 'https://fanqienovel.com',
}

/** 解析 book_id */
export function parseBookId(input) {
  if (!input?.trim()) return null
  const str = input.trim()
  if (/^\d{8,12}$/.test(str)) return str
  for (const p of [/page\/(\d{8,12})/, /novel\/(\d{8,12})/, /book_id=(\d{8,12})/, /(\d{9,12})/]) {
    const m = str.match(p)
    if (m) return m[1]
  }
  return null
}

/** 获取/刷新 Cookie */
async function getCookie() {
  if (cachedCookie && cookieAttempts < 5) return cachedCookie

  // 尝试随机 novel_web_id
  const min = BigInt('1000000000000000000')
  const max = BigInt('9000000000000000000')
  const range = max - min
  const randomBigInt = min + BigInt(Math.floor(Math.random() * Number(range >> BigInt(32)))) * (BigInt(1) << BigInt(32)) + BigInt(Math.floor(Math.random() * 4294967296))
  const webId = randomBigInt.toString()

  // 测试这个 cookie 是否有效
  try {
    const resp = await fetch('https://fanqienovel.com/api/reader/full?itemId=1', {
      headers: { ...BASE_HEADERS, Cookie: `novel_web_id=${webId}` },
      signal: AbortSignal.timeout(5000),
    })
    if (resp.ok) {
      cachedCookie = `novel_web_id=${webId}`
      cookieAttempts = 0
      console.log(`[FanQie] Cookie 获取成功: ${webId.slice(0, 10)}...`)
      return cachedCookie
    }
  } catch {}

  // 暴力尝试 (从 Python 下载器学的方法)
  const base = 1000000000000000000
  const start = base * 6 + Math.floor(Math.random() * base * 2)
  const end = base * 9

  for (let i = start; i < end; i += Math.floor(Math.random() * 10000) + 1) {
    try {
      const testCookie = `novel_web_id=${i}`
      const resp = await fetch('https://fanqienovel.com/api/reader/full?itemId=1', {
        headers: { ...BASE_HEADERS, Cookie: testCookie },
        signal: AbortSignal.timeout(3000),
      })
      if (resp.ok && (await resp.text()).length > 50) {
        cachedCookie = testCookie
        cookieAttempts = 0
        console.log(`[FanQie] Cookie 暴力获取成功: ${i}`)
        return cachedCookie
      }
    } catch {}
    await new Promise(r => setTimeout(r, Math.random() * 100 + 50))
  }

  cookieAttempts++
  throw new Error('无法获取有效的 Cookie')
}

/** 从页面 HTML 提取书籍信息和章节列表 */
async function scrapePage(bookId) {
  const resp = await fetch(`https://fanqienovel.com/page/${bookId}`, {
    headers: BASE_HEADERS,
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) throw new Error(`页面加载失败: ${resp.status}`)
  const html = await resp.text()

  // 提取 __INITIAL_STATE__
  const match = html.match(/__INITIAL_STATE__\s*=\s*({.*?});\s*\n/)
  if (!match) throw new Error('无法解析页面数据')

  const state = JSON.parse(match[1])
  const page = state.page || {}

  // 提取章节列表（从 chapterListWithVolume 或 chapterList）
  let chapters = []
  if (page.chapterListWithVolume?.length > 0) {
    for (const vol of page.chapterListWithVolume) {
      if (vol.chapter_list) chapters.push(...vol.chapter_list)
    }
  } else if (page.chapterList?.length > 0) {
    chapters = page.chapterList
  }

  if (chapters.length === 0) {
    // 从 itemIds 重建章节信息
    if (page.itemIds?.length > 0) {
      chapters = page.itemIds.map((id, i) => ({ item_id: id, title: `第${i + 1}章` }))
    }
  }

  return {
    title: page.bookName || page.book_name || '未知',
    author: page.author || page.originalAuthors || '未知',
    description: page.description || page.abstract || '',
    cover: page.thumbUri || '',
    wordCount: page.wordNumber || 0,
    status: page.status || '',
    chapters: chapters.map((ch, i) => ({
      itemId: String(ch.item_id || ch.content_id || ch.id || ''),
      title: ch.title || ch.chapter_name || `第${i + 1}章`,
      index: i,
    })).filter(ch => ch.itemId),
  }
}

/** 通过 API 获取章节内容（需要 Cookie） */
async function fetchChapterContentViaApi(itemId) {
  const cookie = await getCookie()

  const resp = await fetch(`https://fanqienovel.com/api/reader/full?itemId=${itemId}`, {
    headers: { ...BASE_HEADERS, Cookie: cookie },
    signal: AbortSignal.timeout(15000),
  })

  if (!resp.ok) {
    cachedCookie = '' // Cookie 失效，清除
    throw new Error(`API ${resp.status}`)
  }

  const data = await resp.json()
  let content = ''

  // 兼容不同返回格式
  if (data?.data?.content) {
    content = data.data.content
  } else if (data?.content) {
    content = data.content
  }

  // HTML 清理
  return String(content)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>/gi, '').replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&(?:#\d+|#x[\da-fA-F]+);/g, '')
    .replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n').trim()
}

/** 获取书籍信息 */
export async function fetchBookInfo(bookId) {
  try {
    const info = await scrapePage(bookId)
    return {
      bookId,
      title: info.title,
      author: info.author,
      cover: info.cover || '',
      description: info.description,
      wordCount: info.wordCount || 0,
      status: info.status || '',
    }
  } catch (err) {
    console.warn(`[FanQie] 获取书籍信息失败: ${err.message}`)
    return { bookId, title: `小说${bookId}`, author: '未知', cover: '', description: '', wordCount: 0, status: '' }
  }
}

/** 获取章节目录 */
export async function fetchCatalog(bookId) {
  const info = await scrapePage(bookId)
  if (!info.chapters || info.chapters.length === 0) {
    throw new Error('未找到章节列表')
  }
  return info.chapters
}

/** 获取单章内容 */
export async function fetchChapterContent(itemId) {
  const content = await fetchChapterContentViaApi(itemId)
  if (!content || content.length < 50) {
    throw new Error('内容为空')
  }
  return content
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
          const content = await fetchChapterContentViaApi(ch.itemId)
          onProgress?.(idx + 1, total, ch.title)
          return { index: idx, title: ch.title, itemId: ch.itemId, content, success: true }
        } catch (err) {
          console.warn(`[FanQie] 章节 ${idx + 1} 失败: ${err.message}`)
          onProgress?.(idx + 1, total, ch.title, true)
          return { index: idx, title: ch.title, itemId: ch.itemId, content: '', success: false, error: err.message }
        }
      })
    )
    results.push(...batchResults)
    if (i + config.batchConcurrency < total) {
      await new Promise(r => setTimeout(r, config.requestDelay))
    }
  }

  return results.sort((a, b) => a.index - b.index)
}

/** 合并文本 */
export function mergeToText(results, bookInfo) {
  const header = `《${bookInfo.title}》\n作者：${bookInfo.author}\n\n`
  return header + results.map(ch => {
    const title = `第 ${ch.index + 1} 章 ${ch.title}`
    return ch.success ? `${title}\n${ch.content}` : `${title}\n[内容获取失败]`
  }).join('\n\n')
}
