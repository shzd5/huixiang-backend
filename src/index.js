/**
 * 回响后端服务
 * 小说内容代理 + API 服务
 */
import express from 'express'
import cors from 'cors'
import config from './config.js'
import fanqieRouter from './routes/fanqie.js'

const app = express()

app.use(cors())
app.use(express.json())

// 请求日志
app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    const ms = Date.now() - start
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${ms}ms`)
  })
  next()
})

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    time: new Date().toISOString(),
    uptime: process.uptime(),
    proxies: config.proxyApis,
  })
})

// 网络诊断
app.get('/diagnose', async (req, res) => {
  const results = []
  const targets = [
    'https://fanqienovel.com',
    'http://101.35.133.34:5000',
    'https://api.cengui.cn/api/tomato',
    'https://fanqie.beitai.cc',
    'https://api3-normal-lf.fqnovel.com',
  ]
  for (const url of targets) {
    try {
      const start = Date.now()
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) })
      results.push({ url, status: resp.status, ms: Date.now() - start })
    } catch (err) {
      results.push({ url, error: err.message })
    }
  }

  // 检查 Python 服务器
  let pythonStatus = 'unchecked'
  try {
    const pr = await fetch(`${config.pythonServer}/`, { signal: AbortSignal.timeout(3000) })
    pythonStatus = `online (${pr.status})`
  } catch (e) {
    pythonStatus = `offline: ${e.message}`
  }

  res.json({ results, pythonServer: { url: config.pythonServer, status: pythonStatus } })
})

// 路由
app.use('/api/fanqie', fanqieRouter)

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' })
})

// 错误处理
app.use((err, req, res, next) => {
  console.error('[Server] 未捕获错误:', err)
  res.status(500).json({ error: '服务器内部错误' })
})

app.listen(config.port, () => {
  console.log(`\n🍅 回响后端服务 v1.0.0`)
  console.log(`   地址: http://localhost:${config.port}`)
  console.log(`   健康检查: http://localhost:${config.port}/health`)
  console.log(`   番茄小说API: http://localhost:${config.port}/api/fanqie`)
  console.log(`   抓取全书:   http://localhost:${config.port}/api/fanqie/novel?url=分享链接`)
  console.log(`   流式抓取:   http://localhost:${config.port}/api/fanqie/novel?url=链接&stream=1`)
  console.log(`   代理源:     ${config.proxyApis[0]}\n`)
})
