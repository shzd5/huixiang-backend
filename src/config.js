/**
 * 回响后端 - 配置
 */
export default {
  port: parseInt(process.env.PORT || '3456'),
  // 番茄小说代理 API（社区维护）
  // 可以配多个做 failover
  proxyApis: [
    process.env.PROXY_API || 'https://api.cengui.cn/api/tomato',
  ],
  // 请求间隔（毫秒），防封
  requestDelay: parseInt(process.env.REQUEST_DELAY || '300'),
  // 每批最大并发数
  batchConcurrency: parseInt(process.env.BATCH_CONCURRENCY || '3'),
  // 最大章节数（防止恶意调用）
  maxChapters: parseInt(process.env.MAX_CHAPTERS || '500'),
}
