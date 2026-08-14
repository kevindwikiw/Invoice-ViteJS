# Build the React/Rsbuild frontend and run the Bun/Hono API in one Fly app.
FROM oven/bun:1.3.7 AS build

WORKDIR /app
COPY package.json bun.lock ./
COPY client/package.json client/bun.lock ./client/
COPY server/package.json server/bun.lock ./server/

RUN cd client && bun install --frozen-lockfile
RUN cd server && bun install --frozen-lockfile

COPY client ./client
COPY server ./server
RUN cd client && bun run build

FROM oven/bun:1.3.7-slim AS runtime

WORKDIR /app
COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist

WORKDIR /app/server
ENV NODE_ENV=production
ENV PORT=3000
ENV SQLITE_PATH=/data/sqlite.db
ENV UPLOAD_DIR=/data/uploads/proofs
ENV STATIC_DIR=/app/client/dist

RUN mkdir -p /data/uploads/proofs
EXPOSE 3000
CMD ["bun", "run", "index.ts"]
