FROM node:20-slim

# Install Google Chrome stable + required fonts for Puppeteer/whatsapp-web.js
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update && apt-get install -y \
    google-chrome-stable \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    libxtst6 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Skip Puppeteer's automatic Chromium download and use the system Chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /app

# Install dependencies first for better Docker layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source code
COPY . .

EXPOSE 3004

ENV PORT=3004
ENV NODE_ENV=production

CMD ["node", "server.js"]
