#!/bin/sh
# 启动脚本：先启动 Python 服务器，等它就绪后再启动 Node.js

echo "🚀 启动 Python 下载器..."
python3 /app/python-server/server.py &
PYTHON_PID=$!

# 等待 Python 服务器就绪
echo "⏳ 等待 Python 服务器就绪..."
for i in $(seq 1 30); do
    if curl -s http://localhost:12930/ > /dev/null 2>&1; then
        echo "✅ Python 服务器就绪 (端口 12930)"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "⚠️ Python 服务器未就绪，Node.js 将尝试启动"
    fi
    sleep 2
done

echo "🚀 启动 Node.js 服务器..."
node src/index.js
