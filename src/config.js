/**
 * 回响后端 - 配置
 */
export default {
  port: parseInt(process.env.PORT || '3456'),
  // Python 下载器地址（本地运行）
  pythonServer: process.env.PYTHON_SERVER || 'http://localhost:12930',
  // 番茄小说代理 API（社区维护，作为备选）
  proxyApis: [
    process.env.PROXY_API || 'https://api.cengui.cn/api/tomato',
    'http://101.35.133.34:5000',
    'https://fanqie.beitai.cc',
    'https://fanqie.beitai.vip',
    'https://api.aishu.im/api/tomato',
  ],
  requestDelay: parseInt(process.env.REQUEST_DELAY || '300'),
  batchConcurrency: parseInt(process.env.BATCH_CONCURRENCY || '3'),
  maxChapters: parseInt(process.env.MAX_CHAPTERS || '500'),
}
