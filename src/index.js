import express from 'express'
import cors from 'cors'
import config from './config.js'
import fanqieRouter from './routes/fanqie.js'

const app = express()

app.use(cors())
app.use(express.json())

app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`)
  })
  next()
})

app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', time: new Date().toISOString(), uptime: process.uptime() })
})

app.use('/api/fanqie', fanqieRouter)

app.use((req, res) => res.status(404).json({ error: 'Not Found' }))
app.use((err, req, res, next) => {
  console.error('[Server] 错误:', err)
  res.status(500).json({ error: '服务器内部错误' })
})

app.listen(config.port, () => {
  console.log(`\n🍅 回响后端 v1.0.0 — http://localhost:${config.port}`)
})
