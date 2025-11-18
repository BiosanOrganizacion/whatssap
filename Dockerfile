# Opción basada en Alpine (liviana) con dependencias para Puppeteer/Chromium
FROM node:18-alpine

ENV PUPPETEER_SKIP_DOWNLOAD=false \
    PUPPETEER_CACHE_DIR=/home/node/.cache/puppeteer \
    NODE_ENV=production

# Dependencias de runtime para Chromium
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    udev \
    dumb-init

WORKDIR /home/node/app

COPY package.json package-lock.json* ./
RUN npm ci --only=production || npm install --production

COPY . .

# Variables comunes
ENV PORT=3001 ENABLE_CORS=true WHATSAPP_CLIENT_ID=agenta_local

USER node
EXPOSE 3001

# Ejecutar con flags de sandbox deshabilitado (también definidos en código)
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "index.js"]
