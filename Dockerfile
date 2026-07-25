FROM node:20-alpine

# Install Python and dependencies
RUN apk add --no-cache python3 py3-pip git
RUN pip3 install --break-system-packages flask flask-socketio requests lxml gevent gevent-websocket beautifulsoup4 ebooklib tqdm urllib3

WORKDIR /app

# Copy and install Node.js deps
COPY package*.json ./
RUN npm install --production

# Copy all source code
COPY . .

# Create directories for Python server
RUN mkdir -p /app/python-server/data

# Install fanqie novel downloader
RUN git clone https://github.com/ying-ck/fanqienovel-downloader.git /tmp/fq-server && \
    cp -r /tmp/fq-server/src/* /app/python-server/ && \
    rm -rf /tmp/fq-server

EXPOSE 3456 12930

# Start both servers
CMD python3 /app/python-server/server.py --port 12930 &>/dev/null & \
    sleep 2 && \
    node src/index.js
