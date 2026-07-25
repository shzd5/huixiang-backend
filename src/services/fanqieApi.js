/**
 * 番茄小说 API 服务
 * 优先使用 Python 下载器（本地运行），降级到社区代理
 */
import config from '../config.js'

const PYTHON_SERVER = config.pythonServer

// 社区代理源（降级用）
const PROXY_SOURCES = [
  ...config.proxyApis,
]

let currentApiIndex = 0

function getCurrentApi() {
  return PROXY_SOURCES[currentApiIndex % PROXY_SOURCES.length]
}

function switchApi() {
  currentApiIndex++
  console.warn(`[FanQie] 社区代理切换到: ${getCurrentApi()}`)
}

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

/** 通过 Python 下载器获取全书内容 */
async function fetchViaPython(bookId) {
  const url = `${PYTHON_SERVER}/api/download/${bookId}`
  const resp = await fetch(url, { signal: AbortSignal.timeout(300000) }) // 5min timeout
  if (!resp.ok) throw new Error(`Python 下载器返回 ${resp.status}`)
  return resp
}

/** 通过 Python 下载器获取章节列表 */
async function fetchChaptersViaPython(bookId) {
  const url = `${PYTHON_SERVER}/api/chapters/${bookId}`
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!resp.ok) throw new Error(`章节列表返回 ${resp.status}`)
  const data = await resp.json()
  return data
}

/** 社区代理请求 */
async function proxyRequest(path, retries = 2) {
  const baseUrl = getCurrentApi()
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  const url = `${baseUrl}/${cleanPath}`

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36' },
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const text = await resp.text()
      if (!text || text.length < 10) throw new Error('内容为空')
      try { return JSON.parse(text) } catch { return { data: { content: text } } }
    } catch (err) {
      console.warn(`[FanQie] 社区代理失败: ${url} (${attempt + 1}/${retries + 1}) - ${err.message}`)
      if (attempt < retries) { switchApi(); await new Promise(r => setTimeout(r, 1000)) }
      else throw err
    }
  }
}

/** 获取书籍信息 */
export async function fetchBookInfo(bookId) {
  try {
    // 先试 Python 下载器
    const resp = await fetchChaptersViaPython(bookId)
    if (resp?.name) {
      return {
        bookId,
        title: resp.name || '未知',
        author: resp.author || '未知',
        cover: resp.cover || '',
        description: resp.description || '',
        wordCount: resp.word_count || 0,
        status: resp.status || '',
      }
    }
  } catch {}
  // 降级：从社区代理获取
  for (const path of [`api/detail?book_id=${bookId}`, `detail?book_id=${bookId}`, `info.php?book_id=${bookId}`]) {
    try {
      const data = await proxyRequest(path)
      const info = data?.data?.data || data?.data || {}
      if (info?.book_name || info?.title) {
        return {
          bookId, title: info.book_name || info.title || '未知', author: info.author || '未知',
          cover: info.cover || '', description: info.description || info.desc || '',
          wordCount: info.word_number || info.word_count || 0, status: info.creation_status || info.status || '',
        }
      }
    } catch {}
  }
  return { bookId, title: `小说${bookId}`, author: '未知', cover: '', description: '', wordCount: 0, status: '' }
}

/** 获取章节目录 */
export async function fetchCatalog(bookId) {
  // 优先 Python 下载器
  try {
    const data = await fetchChaptersViaPython(bookId)
    if (data?.chapters?.length > 0) {
      return data.chapters.map((ch, i) => ({
        itemId: String(ch.item_id || ch.id || ''),
        title: ch.title || `第${i + 1}章`,
        index: i,
        isVip: !!ch.is_vip,
      })).filter(ch => ch.itemId)
    }
  } catch (e) { console.warn('[FanQie] Python获取目录失败:', e.message) }

  // 降级社区代理
  const paths = [`api/directory?book_id=${bookId}`, `api/book?book_id=${bookId}`, `directory?book_id=${bookId}`, `directory.php?book_id=${bookId}`]
  for (const path of paths) {
    try {
      const data = await proxyRequest(path)
      const raw = data?.data?.data?.chapter_list || data?.data?.chapter_list || data?.chapter_list || data?.data?.data || data?.data || data || []
      const list = Array.isArray(raw) ? raw : (raw.chapters || raw.list || raw.items || [])
      if (list.length > 0) {
        return list.map((ch, i) => ({
          itemId: String(ch.item_id || ch.content_id || ch.id || ''),
          title: ch.title || ch.chapter_name || `第${i + 1}章`,
          index: i, isVip: !!ch.is_vip || !!ch.isVip,
        })).filter(ch => ch.itemId)
      }
    } catch {}
  }
  throw new Error('获取目录失败：Python下载器未启动且代理不可用')
}

/** 获取单章内容 */
export async function fetchChapterContent(itemId) {
  const paths = [`api/content?item_id=${itemId}`, `content?item_id=${itemId}`, `content.php?item_id=${itemId}`]
  for (const path of paths) {
    try {
      const data = await proxyRequest(path)
      let content = data?.data?.data?.content || data?.data?.content || data?.content || ''
      if (typeof content === 'object') content = content.content || content.text || ''
      content = String(content)
        .replace(/<br\s*\/?>/gi, '\n').replace(/<p[^>]*>/gi, '').replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n').trim()
      if (content.length > 50) return content
    } catch {}
  }
  throw new Error('获取章节内容失败')
}

/** 批量获取 */
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
