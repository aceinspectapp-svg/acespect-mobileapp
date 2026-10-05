FROM node:22-alpine AS builder
WORKDIR /app
# The report-PDF feature's `puppeteer` dependency would otherwise spend the
# build downloading its own bundled Chrome -- a glibc build that can't run
# on this image's musl libc anyway (see the final stage's system `chromium`
# package), so there's no point fetching it at all.
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci
RUN npx prisma generate
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
# Puppeteer needs an actual browser present at runtime -- Alpine's own
# `chromium` package (built for musl) rather than Puppeteer's downloaded one
# (built for glibc, and which the builder stage skips fetching above).
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "dist/server.js"]
