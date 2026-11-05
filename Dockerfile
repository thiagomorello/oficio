# Oficio: client build (Vite) + server build (esbuild); final image ships production dependencies only.
FROM node:22.23.4-alpine AS builder
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22.23.4-alpine
LABEL org.opencontainers.image.title="Oficio"       org.opencontainers.image.description="Open source self-hosted virtual office: pixel-art map, proximity audio/video with LiveKit, chat and meeting rooms."       org.opencontainers.image.source="https://github.com/thiagomorello/oficio"       org.opencontainers.image.licenses="MIT"
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=builder /app/dist ./dist
ENV NODE_ENV=production OFFICE_IN_DOCKER=1 OFFICE_HOST=0.0.0.0 OFFICE_PORT=4747
USER node
EXPOSE 4747
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:4747/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node","dist/server/index.js"]
