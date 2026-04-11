# syntax=docker/dockerfile:1
FROM node:20-bookworm AS client-build
WORKDIR /build
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci
COPY client/ ./client/
RUN cd client && npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/ ./server/
COPY --from=client-build /build/client/dist ./static
ENV NODE_ENV=production
ENV PORT=3001
ENV CLIENT_DIST=/app/static
WORKDIR /app/server
EXPOSE 3001
CMD ["node", "index.js"]
