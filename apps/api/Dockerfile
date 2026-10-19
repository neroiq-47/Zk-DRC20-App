# Build context: repository root (the API reads database/migrations and the workspace packages).
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @zoko/api...
RUN pnpm --filter @zoko/api build

FROM node:22-slim
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json
RUN pnpm install --frozen-lockfile --prod --filter @zoko/api...
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY database ./database
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["sh", "-c", "node dist/scripts/migrate.js && node dist/index.js"]
