FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/queue/package.json packages/queue/package.json
COPY packages/upstream/package.json packages/upstream/package.json
RUN pnpm install --frozen-lockfile
COPY apps/worker apps/worker
COPY packages packages
RUN pnpm --filter @keyhub/database prisma:generate && pnpm --filter @keyhub/worker... build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY --from=build --chown=node:node /app /app
USER node
CMD ["node", "apps/worker/dist/index.js"]
