# syntax=docker/dockerfile:1
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production NODE_NO_WARNINGS=1
WORKDIR /app
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server/src ./src
COPY --from=web /web/dist ./public
EXPOSE 8099
CMD ["node", "src/index.js"]
