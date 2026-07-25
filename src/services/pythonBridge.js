/**
 * Python 下载器桥接模块
 * 通过子进程调用 fanqienovel-downloader 的 Python 脚本
 * 不依赖独立服务器运行
 */
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PYTHON_DIR = join(__dirname, '..', '..', 'python-server')

/**
 * 检查 Python 环境和依赖
 */
export function checkPythonEnvironment() {
  const dirs = [
    PYTHON_DIR,
    join(PYTHON_DIR, 'data'),
  ]
  const files = [
    join(PYTHON_DIR, 'main.py'),
  ]
  return {
    dirsExist: dirs.every(d => existsSync(d)),
    filesExist: files.every(f => existsSync(f)),
    pythonDir: PYTHON_DIR,
  }
}

/**
 * 通过 Python 子进程下载小说
 * @param {string} novelId - 番茄小说 ID
 * @param {function} onProgress - 进度回调
 * @returns {Promise<object>} 小说内容
 */
export function downloadNovel(novelId, onProgress) {
  return new Promise((resolve, reject) => {
    try {
      // 先检查环境
      const env = checkPythonEnvironment()
      if (!env.filesExist) {
        // Python 脚本不存在，report
        reject(new Error('PYTHON_NOT_AVAILABLE'))
        return
      }

      // 写一个临时的 Python 脚本
      const script = `
import sys
sys.path.insert(0, '${PYTHON_DIR.replace(/\\/g, '\\\\')}')
from main import NovelDownloader, Config, SaveMode

config = Config()
downloader = NovelDownloader(config)

# Download the novel
result = downloader.download_novel(${novelId})
if result == 'err':
    print('ERROR: 下载失败')
else:
    print(result)
`
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3'
      const child = spawn(pythonCmd, ['-c', script], {
        cwd: PYTHON_DIR,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 600000, // 10 min timeout
      })

      let output = ''
      let errorOutput = ''

      child.stdout.on('data', (data) => {
        const text = data.toString()
        output += text
        // 尝试解析进度信息
        if (onProgress && text.includes('下载进度')) {
          const match = text.match(/(\d+)\/(\d+)/)
          if (match) onProgress(parseInt(match[1]), parseInt(match[2]))
        }
      })

      child.stderr.on('data', (data) => {
        errorOutput += data.toString()
      })

      child.on('close', (code) => {
        if (code === 0 && output) {
          resolve(output)
        } else if (output.startsWith('ERROR:')) {
          reject(new Error(output.slice(6).trim()))
        } else {
          reject(new Error(errorOutput || `进程退出码 ${code}`))
        }
      })

      child.on('error', (err) => {
        reject(new Error(`启动 Python 失败: ${err.message}`))
      })
    } catch (err) {
      reject(err)
    }
  })
}

/**
 * 直接读取下载好的 TXT 文件
 */
export function getDownloadedNovelPath(novelId) {
  const downloadsDir = join(PYTHON_DIR, 'novel_downloads')
  return downloadsDir
}
