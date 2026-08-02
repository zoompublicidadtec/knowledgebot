# --- STAGE 1: Install dependencies ---
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy lockfiles and package.json to install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# --- STAGE 2: Build the application ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Disable Next.js telemetry during the build
ENV NEXT_TELEMETRY_DISABLED=1
# Force production environment
ENV NODE_ENV=production
# Restrict memory and CPU cores during build to avoid VPS memory exhaustion (SIGKILL)
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV NEXT_CPU_LIMIT=1

RUN npm run build

# --- STAGE 3: Production Runner ---
FROM node:20-alpine AS runner
WORKDIR /app

# ffmpeg: convierte lo que graba el navegador (webm/opus) a lo unico que
# WhatsApp acepta como NOTA DE VOZ (ogg/opus). Sin el, el audio llega como
# archivo adjunto y el cliente no lo puede oir de un toque.
#
# Va aqui, en la etapa final, y no arriba del todo: puesto antes invalidaria
# la capa del `npm install`, y este proyecto NO tiene package-lock del puente,
# asi que reinstalar seria dejar que las librerias cambien solas.
RUN apk add --no-cache ffmpeg

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3003
ENV HOSTNAME="0.0.0.0"

# Create system user and group for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Create empty .next directory with correct ownership
RUN mkdir .next && chown nextjs:nodejs .next

# Copy built standalone folder, static assets, and public files
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Use non-root user
USER nextjs

EXPOSE 3003

# Next.js standalone mode generates a server.js file to start the server
CMD ["node", "server.js"]
