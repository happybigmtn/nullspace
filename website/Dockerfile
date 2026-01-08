FROM rust:1.83-slim-bookworm AS wasm-builder

RUN apt-get update && apt-get install -y \
    curl \
    libssl-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

RUN curl -sSf https://rustwasm.github.io/wasm-pack/installer/init.sh | sh

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY execution/Cargo.toml ./execution/
COPY types/Cargo.toml ./types/
COPY website/wasm/Cargo.toml ./website/wasm/

RUN mkdir -p execution/src types/src website/wasm/src && \
    echo "pub fn placeholder() {}" > execution/src/lib.rs && \
    echo "pub fn placeholder() {}" > types/src/lib.rs && \
    echo "pub fn placeholder() {}" > website/wasm/src/lib.rs

RUN wasm-pack build --target web --out-dir pkg website/wasm 2>/dev/null || true

RUN rm -rf execution/src types/src website/wasm/src

COPY execution/ ./execution/
COPY types/ ./types/
COPY website/wasm/ ./website/wasm/

RUN wasm-pack build --target web --out-dir pkg website/wasm

FROM node:20-slim AS web-builder

RUN corepack enable

WORKDIR /app

# Copy workspace config and all package dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/
COPY website/package.json ./website/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build workspace packages first
RUN pnpm -C packages/types build || true
RUN pnpm -C packages/constants build || true
RUN pnpm -C packages/protocol build || true
RUN pnpm -C packages/design-tokens build || true
RUN pnpm -C packages/game-state build || true

COPY website/ /app/website/
COPY economy_log.json /app/economy_log.json
COPY --from=wasm-builder /app/website/wasm/pkg /app/website/wasm/pkg

ARG VITE_IDENTITY
ARG VITE_URL
ARG VITE_AUTH_URL
ARG VITE_AUTH_PROXY_URL
ARG VITE_STRIPE_TIERS
ARG VITE_STRIPE_PRICE_ID
ARG VITE_STRIPE_TIER

ENV VITE_IDENTITY=$VITE_IDENTITY \
    VITE_URL=$VITE_URL \
    VITE_AUTH_URL=$VITE_AUTH_URL \
    VITE_AUTH_PROXY_URL=$VITE_AUTH_PROXY_URL \
    VITE_STRIPE_TIERS=$VITE_STRIPE_TIERS \
    VITE_STRIPE_PRICE_ID=$VITE_STRIPE_PRICE_ID \
    VITE_STRIPE_TIER=$VITE_STRIPE_TIER

WORKDIR /app/website

RUN pnpm run build

FROM nginx:1.27-alpine

COPY website/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-builder /app/website/dist /usr/share/nginx/html
