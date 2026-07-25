export default {
  port: parseInt(process.env.PORT || '3456'),
  requestDelay: parseInt(process.env.REQUEST_DELAY || '300'),
  batchConcurrency: parseInt(process.env.BATCH_CONCURRENCY || '3'),
  maxChapters: parseInt(process.env.MAX_CHAPTERS || '500'),
}
