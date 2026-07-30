FROM node:20-slim

# Baileys NO requiere Chrome ni Puppeteer.
# El contenedor es mucho más liviano que el puente whatsapp-web.js.

# git: requerido por dependencias transitivas de Baileys.
# openssh-client: Baileys declara libsignal-node con URL ssh:// de GitHub.
# ca-certificates: para que git verifique el SSL de github.com al clonar por HTTPS.
# curl: utilidad de diagnóstico.
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Forzar a git a usar HTTPS público en vez de SSH.
# El GIT_CONFIG_PARAMETERS es leído por git SIEMPRE, incluso cuando es
# invocado por npm, a diferencia del git config global que a veces se ignora.
ENV GIT_CONFIG_COUNT=1
ENV GIT_CONFIG_KEY_0=url.https://github.com/.insteadOf
ENV GIT_CONFIG_VALUE_0=ssh://git@github.com/

WORKDIR /app

# Copiar dependencias y instalar (solo producción).
# Se usa npm install (no npm ci) porque este MVP no genera package-lock.
COPY package*.json ./
RUN npm install --omit=dev

# Copiar el código del puente.
COPY server.js ./

# Puerto del puente Baileys (diferente del 3004 del puente actual).
ENV PORT=3005
ENV NODE_ENV=production

EXPOSE 3005

# pino logs legibles en consola.
CMD ["node", "server.js"]
