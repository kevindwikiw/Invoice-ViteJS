# Build the React/Rsbuild frontend and run the Bun/Hono API in one Fly app.
FROM oven/bun:1.3.7 AS build

WORKDIR /app
COPY package.json bun.lock ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json

RUN bun install --frozen-lockfile

COPY client ./client
COPY server ./server
RUN cd client && bun run build

FROM oven/bun:1.3.7-slim AS runtime

WORKDIR /app
COPY package.json bun.lock ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN bun install --production --filter=server --frozen-lockfile
COPY server ./server
COPY --from=build /app/client/dist ./client/dist

ENV NODE_ENV=production
ENV PORT=3000
ENV STATIC_DIR=/app/client/dist

WORKDIR /app/server
EXPOSE 3000
CMD ["bun", "index.ts"]
