/**
 * 番茄小说 API 路由
 */
import { Router } from 'express'
import {
  parseBookId,
  fetchBookInfo,
  fetchCatalog,
  fetchAllContent,
  mergeToText,
} from '../services/fanqieApi.js'

const router = Router()

/**
 * GET /api/fanqie/info
 * 查询书籍信息
 * query: url (分享链接) 或 book_id
 */
router.get('/info', async (req, res) => {
  try {
    const input = req.query.url || req.query.book_id
    if (!input) {
      return res.status(400).json({ error: '请提供 url 或 book_id' })
    }

    const bookId = parseBookId(input)
    if (!bookId) {
      return res.status(400).json({ error: '无法识别链接，请检查是否为番茄小说分享链接' })
    }

    const info = await fetchBookInfo(bookId)
    res.json({ success: true, data: info })
  } catch (err) {
    console.error('[Route] 获取书籍信息失败:', err)
    res.status(500).json({ error: `获取书籍信息失败: ${err.message}` })
  }
})

/**
 * GET /api/fanqie/catalog
 * 获取章节目录
 * query: url 或 book_id
 */
router.get('/catalog', async (req, res) => {
  try {
    const input = req.query.url || req.query.book_id
    if (!input) {
      return res.status(400).json({ error: '请提供 url 或 book_id' })
    }

    const bookId = parseBookId(input)
    if (!bookId) {
      return res.status(400).json({ error: '无法识别链接' })
    }

    const chapters = await fetchCatalog(bookId)
    res.json({
      success: true,
      data: {
        bookId,
        total: chapters.length,
        chapters: chapters.map(ch => ({
          index: ch.index,
          title: ch.title,
          itemId: ch.itemId,
          isVip: ch.isVip,
        })),
      },
    })
  } catch (err) {
    console.error('[Route] 获取目录失败:', err)
    res.status(500).json({ error: `获取目录失败: ${err.message}` })
  }
})

/**
 * GET /api/fanqie/novel
 * 获取全书内容（核心接口）
 */
router.get('/novel', async (req, res) => {
  try {
    const input = req.query.url || req.query.book_id
    if (!input) return res.status(400).json({ error: '请提供 url 或 book_id' })
    const bookId = parseBookId(input)
    if (!bookId) return res.status(400).json({ error: '无法识别链接' })

    const bookInfo = await fetchBookInfo(bookId)
    console.log(`[Route] 开始抓取: ${bookInfo.title} (book_id=${bookId})`)

    const chapters = await fetchCatalog(bookId)
    console.log(`[Route] 获取到 ${chapters.length} 章`)

    if (req.query.stream === '1') {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.write(`data: ${JSON.stringify({ type: 'info', data: bookInfo, total: chapters.length })}\n\n`)

      const results = await fetchAllContent(chapters, (current, total, title, failed) => {
        res.write(`data: ${JSON.stringify({ type: 'progress', current, total, title, failed: !!failed })}\n\n`)
      })

      const successCount = results.filter(r => r.success).length
      const text = mergeToText(results, bookInfo)
      const completeData = {
        type: 'complete',
        data: {
          bookId,
          title: bookInfo.title,
          author: bookInfo.author,
          totalChapters: chapters.length,
          successChapters: successCount,
          failedChapters: chapters.length - successCount,
          text,
          chapters: results.map(r => ({ index: r.index, title: r.title, success: r.success })),
        },
      }
      res.write(`data: ${JSON.stringify(completeData)}\n\n`)
      res.end()
      return
    }

    const results = await fetchAllContent(chapters)
    const successCount = results.filter(r => r.success).length
    const text = mergeToText(results, bookInfo)
    console.log(`[Route] 完成: ${successCount}/${chapters.length} 章成功`)
    res.json({ success: true, data: { bookId, title: bookInfo.title, author: bookInfo.author, totalChapters: chapters.length, successChapters: successCount, failedChapters: chapters.length - successCount, text, chapters: results.map(r => ({ index: r.index, title: r.title, success: r.success })) } })
  } catch (err) {
    console.error('[Route] 抓取失败:', err.message)
    const isNetwork = err.message?.includes('fetch failed') || err.message?.includes('ENOTFOUND') || err.message?.includes('ECONNREFUSED')
    res.status(500).json({
      error: isNetwork
        ? `代理源不可用：当前网络环境无法连接番茄小说的代理服务器。\n\n解决方案：\n1. 将后端部署到 Railway/Zeabur 等云平台可解决\n2. 也可以先用「粘贴内容」或书签工具导入小说`
        : `抓取失败: ${err.message}`,
    })
  }
})

/**
 * GET /api/fanqie/chapter
 * 获取单章内容
 * query: item_id
 */
router.get('/chapter', async (req, res) => {
  try {
    const { default: config } = await import('../config.js')
    const { fetchChapterContent } = await import('../services/fanqieApi.js')

    const itemId = req.query.item_id
    if (!itemId) {
      return res.status(400).json({ error: '请提供 item_id' })
    }

    const content = await fetchChapterContent(itemId)
    res.json({ success: true, data: { itemId, content } })
  } catch (err) {
    res.status(500).json({ error: `获取章节失败: ${err.message}` })
  }
})

export default router
