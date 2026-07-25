/**
 * 番茄小说网页版 Scraper
 * 使用 Puppeteer + Edge 渲染页面，提取小说内容
 * 作为代理 API 不可用时的降级方案
 */
import puppeteer from 'puppeteer-core'

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

let browserInstance = null

async function getBrowser() {
  if (browserInstance && browserInstance.connected) {
    return browserInstance
  }
  try {
    browserInstance = await puppeteer.launch({
      executablePath: EDGE_PATH,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,800',
      ],
    })
    return browserInstance
  } catch (err) {
    throw new Error(`启动浏览器失败: ${err.message}。请确保已安装 Microsoft Edge。`)
  }
}

/**
 * 从页面提取 __INITIAL_STATE__
 */
function extractInitialState(html) {
  const match = html.match(/__INITIAL_STATE__\s*=\s*({.*?});\s*\n/)
  if (!match) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

/**
 * 获取书籍信息 + 目录（通过渲染页面）
 */
export async function scrapeBookInfo(bookId) {
  const browser = await getBrowser()
  const page = await browser.newPage()

  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    await page.setViewport({ width: 1280, height: 800 })

    // 导航到书籍详情页
    await page.goto(`https://fanqienovel.com/page/${bookId}`, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    })

    // 等待页面加载完成
    await page.waitForTimeout(3000)

    // 获取页面数据
    const result = await page.evaluate(() => {
      // 尝试从 React 状态中提取
      const appRoot = document.querySelector('#app')
      if (!appRoot) return null

      // 提取基本信息
      const title = document.querySelector('.book-title')?.textContent ||
                    document.querySelector('h1')?.textContent ||
                    document.title

      const author = document.querySelector('.author-name')?.textContent ||
                     document.querySelector('.author-info')?.textContent ||
                     ''

      const description = document.querySelector('.book-desc, .description, .abstract')?.textContent || ''

      // 提取封面
      const cover = document.querySelector('.book-cover img, .cover img')?.getAttribute('src') || ''

      // 提取章节列表
      const chapterItems = document.querySelectorAll('.chapter-item, .chapter-list .item, [class*="chapter"] a')
      const chapters = Array.from(chapterItems).map((el, i) => ({
        index: i,
        title: el.textContent?.trim() || `第 ${i + 1} 章`,
        link: el.getAttribute('href') || '',
        itemId: el.getAttribute('data-id') || el.getAttribute('data-item-id') || '',
      })).filter(ch => ch.title)

      // 提取状态信息
      const wordCount = document.querySelector('[class*="word"]')?.textContent || ''
      const status = document.querySelector('[class*="status"]')?.textContent || ''

      return { title, author, description, cover, wordCount, status, chapters }
    })

    return result
  } catch (err) {
    throw new Error(`抓取书籍信息失败: ${err.message}`)
  } finally {
    await page.close()
  }
}

/**
 * 获取单章内容（通过渲染 reader 页面）
 */
export async function scrapeChapterContent(bookId, itemId) {
  const browser = await getBrowser()
  const page = await browser.newPage()

  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
    await page.setViewport({ width: 1280, height: 800 })

    // 导航到阅读页
    await page.goto(`https://fanqienovel.com/reader/${bookId}/${itemId}`, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    })

    await page.waitForTimeout(2000)

    // 提取内容
    const content = await page.evaluate(() => {
      // 尝试多种选择器
      const selectors = [
        '.chapter-content',
        '.read-content',
        '.content-text',
        '.article-content',
        '.story-content',
        'article',
        '[class*="content"]',
        '[class*="text"]',
      ]

      for (const sel of selectors) {
        const el = document.querySelector(sel)
        if (el && el.textContent && el.textContent.length > 100) {
          return el.textContent.trim()
        }
      }

      // 最后尝试获取主要文本区域
      const main = document.querySelector('main') || document.querySelector('.main') || document.body
      return main?.textContent?.trim() || ''
    })

    return content
  } catch (err) {
    throw new Error(`抓取章节内容失败: ${err.message}`)
  } finally {
    await page.close()
  }
}

/**
 * 获取全书内容（逐章抓取）
 */
export async function scrapeFullNovel(bookId, onProgress) {
  // 先获取目录
  const bookInfo = await scrapeBookInfo(bookId)
  if (!bookInfo || !bookInfo.chapters || bookInfo.chapters.length === 0) {
    throw new Error('未能获取到章节列表')
  }

  const chapters = bookInfo.chapters
  const total = chapters.length
  const results = []

  for (let i = 0; i < total; i++) {
    const ch = chapters[i]
    try {
      const content = await scrapeChapterContent(bookId, ch.itemId)
      results.push({
        index: i,
        title: ch.title,
        content,
        success: true,
      })
      if (onProgress) onProgress(i + 1, total, ch.title)
    } catch (err) {
      results.push({
        index: i,
        title: ch.title,
        content: '',
        success: false,
        error: err.message,
      })
      if (onProgress) onProgress(i + 1, total, ch.title, true)
    }
  }

  return {
    title: bookInfo.title,
    author: bookInfo.author,
    description: bookInfo.description,
    totalChapters: total,
    successChapters: results.filter(r => r.success).length,
    chapters: results,
  }
}

/**
 * 关闭浏览器
 */
export async function closeBrowser() {
  if (browserInstance) {
    try {
      await browserInstance.close()
    } catch {}
    browserInstance = null
  }
}
