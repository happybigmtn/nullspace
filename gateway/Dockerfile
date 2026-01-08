FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y \
    curl \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
ENV PATH=/root/.cargo/bin:$PATH

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY Cargo.toml Cargo.lock ./
COPY packages/ ./packages/
COPY gateway/ ./gateway/
COPY types/ ./types/

RUN pnpm install --frozen-lockfile --ignore-scripts

# Generate types (requires cargo)
RUN pnpm -C packages/types run generate
RUN pnpm -C packages/types build
RUN pnpm -C packages/constants build
RUN pnpm -C packages/protocol build
RUN pnpm -C gateway build

FROM node:20-slim

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY gateway/package.json gateway/tsconfig.json /app/gateway/
COPY packages/constants/package.json /app/packages/constants/
COPY packages/protocol/package.json /app/packages/protocol/
COPY packages/types/package.json /app/packages/types/

RUN pnpm install --prod --frozen-lockfile --filter @nullspace/gateway... --ignore-scripts

COPY --from=builder /app/gateway/dist /app/gateway/dist
COPY --from=builder /app/packages/constants/dist /app/packages/constants/dist
COPY --from=builder /app/packages/protocol/dist /app/packages/protocol/dist
COPY --from=builder /app/packages/types/dist /app/packages/types/dist

RUN chown -R node:node /app
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.GATEWAY_PORT || 9010) + '/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "/app/gateway/dist/index.js"]
