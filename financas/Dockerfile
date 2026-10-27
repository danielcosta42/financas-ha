# syntax=docker/dockerfile:1
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production NODE_NO_WARNINGS=1
WORKDIR /app
COPY server/package.json server/package-lock.json ./
# --omit=optional: o @napi-rs/canvas (opcional do pdfjs) usa instruções que a CPU da VM não tem (SIGILL, exit 132)
RUN npm ci --omit=dev --omit=optional --no-audit --no-fund
COPY server/src ./src
COPY --from=web /web/dist ./public
EXPOSE 8099
CMD ["node", "src/index.js"]
