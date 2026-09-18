FROM node:22-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build-web
COPY vite.config.ts tsconfig.json ./
COPY web ./web
RUN npm run build:web

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY --from=build-web /app/web/dist ./web/dist
USER node
EXPOSE 3000
CMD ["node", "src/server.ts"]
