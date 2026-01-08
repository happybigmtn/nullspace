FROM rust:1.83-slim-bookworm AS wasm-builder

RUN apt-get update && apt-get install -y \
    curl \
    libssl-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

RUN curl -sSf https://rustwasm.github.io/wasm-pack/installer/init.sh | sh

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY node/Cargo.toml ./node/
COPY client/Cargo.toml ./client/
COPY execution/Cargo.toml ./execution/
COPY simulator/Cargo.toml ./simulator/
COPY types/Cargo.toml ./types/
COPY website/wasm/Cargo.toml ./website/wasm/

RUN mkdir -p node/src client/src execution/src simulator/src types/src website/wasm/src && \
    echo "fn main() {}" > node/src/main.rs && \
    echo "fn main() {}" > client/src/main.rs && \
    echo "pub fn placeholder() {}" > execution/src/lib.rs && \
    echo "fn main() {}" > simulator/src/main.rs && \
    echo "pub fn placeholder() {}" > types/src/lib.rs && \
    echo "pub fn placeholder() {}" > website/wasm/src/lib.rs

RUN wasm-pack build --target web --out-dir pkg website/wasm 2>/dev/null || true

RUN rm -rf node/src client/src execution/src simulator/src types/src website/wasm/src

COPY node/ ./node/
COPY client/ ./client/
COPY execution/ ./execution/
COPY simulator/ ./simulator/
COPY types/ ./types/
COPY website/wasm/ ./website/wasm/

RUN wasm-pack build --target web --out-dir pkg website/wasm

FROM node:20-slim AS build

RUN corepack enable

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/auth/package.json /app/services/auth/
COPY website/package.json /app/website/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @nullspace/auth...

COPY services/auth/tsconfig.json /app/services/auth/
COPY services/auth/src /app/services/auth/src
COPY website/convex/_generated /app/website/convex/_generated
COPY --from=wasm-builder /app/website/wasm/pkg /app/website/wasm/pkg

WORKDIR /app/services/auth
RUN pnpm run build

FROM node:20-slim

RUN corepack enable

WORKDIR /app
ENV NODE_ENV=production

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/auth/package.json /app/services/auth/
COPY website/package.json /app/website/

RUN pnpm install --prod --frozen-lockfile --filter @nullspace/auth... --ignore-scripts

COPY --from=build /app/services/auth/dist /app/services/auth/dist
COPY --from=build /app/website/convex/_generated /app/website/convex/_generated
COPY --from=build /app/website/wasm/pkg /app/website/wasm/pkg

RUN chown -R node:node /app/services/auth /app/website
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "/app/services/auth/dist/server.js"]
