FROM node:20-slim AS build

RUN corepack enable

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/ops/package.json /app/services/ops/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter nullspace-ops...

COPY services/ops/tsconfig.json /app/services/ops/
COPY services/ops/src /app/services/ops/src

WORKDIR /app/services/ops
RUN pnpm run build

FROM node:20-slim

RUN corepack enable

WORKDIR /app
ENV NODE_ENV=production

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/ops/package.json /app/services/ops/

RUN pnpm install --prod --frozen-lockfile --filter nullspace-ops... --ignore-scripts

COPY --from=build /app/services/ops/dist /app/services/ops/dist

RUN chown -R node:node /app/services/ops
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.OPS_PORT || 9020) + '/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "/app/services/ops/dist/server.js"]
