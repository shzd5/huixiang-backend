/**
 * 番茄小说 API 服务
 * 支持多代理源自动切换 + Puppeteer 降级
 */
import config from '../config.js'

// 多个可用的代理源（按优先级）
const PROXY_SOURCES = [
  ...config.proxyApis,
  'http://101.35.133.34:5000',
  'https://api.cengui.cn/api/tomato',
  'https://fanqie.beitai.cc',
  'https://fanqie.beitai.vip',
  'http://fq.travacocro.com',
  'https://api.aishu.im/api/tomato',
]

let currentApiIndex = 0
let scraperFallback = null

function getCurrentApi() {
  return PROXY_SOURCES[currentApiIndex % PROXY_SOURCES.length]
}

function switchApi() {
  currentApiIndex++
  const next = getCurrentApi()
  console.warn(`[FanQie] 切换到: ${next}`)
  return next
}

function resetApiIndex() {
  currentApiIndex = 0
}

export function setScraperFallback(module) {
  scraperFallback = module
}

async function request(path, retries = 2) {
  const baseUrl = getCurrentApi()
  // 统一路径格式：兼容带/api前缀和不带的
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  const url = `${baseUrl}/${cleanPath}`

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Referer': 'https://fanqienovel.com/',
        },
      })
      clearTimeout(timeout)

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const text = await response.text()
      if (!text || text.length < 10) throw new Error('内容为空')

      try {
        return JSON.parse(text)
      } catch {
        return { data: { content: text } }
      }
    } catch (err) {
      console.warn(`[FanQie] 失败 (${attempt + 1}/${retries + 1}): ${url} - ${err.message}`)
      if (attempt < retries) {
        switchApi()
        await new Promise(r => setTimeout(r, 1000))
      } else {
        throw err
      }
    }
  }
}

/** 从链接提取 book_id */
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

/** 获取书籍信息 */
export async function fetchBookInfo(bookId) {
  // 尝试多种路径
  for (const path of [`api/detail?book_id=${bookId}`, `detail?book_id=${bookId}`, `info?book_id=${bookId}`, `info.php?book_id=${bookId}`]) {
    try {
      const data = await request(path)
      const info = data?.data?.data || data?.data || {}
      if (info?.book_name || info?.title) {
        return {
          bookId,
          title: info.book_name || info.title || '未知',
          author: info.author || '未知',
          cover: info.cover || '',
          description: info.description || info.desc || '',
          wordCount: info.word_number || info.word_count || 0,
          status: info.creation_status || info.status || '',
        }
      }
    } catch {}
  }
  return { bookId, title: `小说${bookId}`, author: '未知', cover: '', description: '', wordCount: 0, status: '' }
}

/** 获取章节目录 */
export async function fetchCatalog(bookId) {
  const paths = [
    `api/directory?book_id=${bookId}`,
    `api/book?book_id=${bookId}`,
    `directory?book_id=${bookId}`,
    `directory.php?book_id=${bookId}`,
    `api/directory/all_items/v/?book_id=${bookId}`,
  ]

  for (const path of paths) {
    try {
      const data = await request(path)
      const raw = data?.data?.data?.chapter_list || data?.data?.chapter_list || data?.chapter_list || data?.data?.data || data?.data || data || []
      const list = Array.isArray(raw) ? raw : (raw.chapters || raw.list || raw.items || [])
      if (list.length > 0) {
        return list.map((ch, i) => ({
          itemId: String(ch.item_id || ch.content_id || ch.id || ''),
          title: ch.title || ch.chapter_name || ch.name || `第${i + 1}章`,
          index: i,
          isVip: !!ch.is_vip || !!ch.isVip || !!ch.vip_status,
        })).filter(ch => ch.itemId)
      }
    } catch {}
  }
  throw new Error('获取目录失败：所有代理源均不可用')
}

/** 获取单章内容 */
export async function fetchChapterContent(itemId) {
  const paths = [
    `api/content?item_id=${itemId}`,
    `content?item_id=${itemId}`,
    `content.php?item_id=${itemId}`,
    `api/content/item/v1/?item_id=${itemId}`,
  ]

  for (const path of paths) {
    try {
      const data = await request(path)
      let content = data?.data?.data?.content || data?.data?.content || data?.content || ''
      if (typeof content === 'object') content = content.content || content.text || ''
      content = String(content)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<p[^>]*>/gi, '').replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
        .replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n').trim()
      if (content.length > 50) return content
    } catch {}
  }
  throw new Error('获取章节内容失败')
}

/** 批量获取（控制并发） */
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
          console.warn(`[FanQie] 章节 ${idx + 1} 失败: ${err.message}`)
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

/** 合并结果 */
export function mergeToText(results, bookInfo) {
  const header = `《${bookInfo.title}》\n作者：${bookInfo.author}\n\n`
  return header + results.map(ch => {
    const title = `第 ${ch.index + 1} 章 ${ch.title}`
    return ch.success ? `${title}\n${ch.content}` : `${title}\n[内容获取失败]`
  }).join('\n\n')
}
