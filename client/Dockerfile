FROM rust:1.83-slim-bookworm AS builder

RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY client/Cargo.toml ./client/
COPY execution/Cargo.toml ./execution/
COPY types/Cargo.toml ./types/

RUN mkdir -p client/src/bin execution/src types/src && \
    echo "pub fn placeholder() {}" > client/src/lib.rs && \
    echo "fn main() {}" > client/src/bin/dev_executor.rs && \
    echo "pub fn placeholder() {}" > execution/src/lib.rs && \
    echo "pub fn placeholder() {}" > types/src/lib.rs

RUN cargo build --release --bin dev-executor 2>/dev/null || true

RUN rm -rf client/src execution/src types/src

COPY client/ ./client/
COPY execution/ ./execution/
COPY types/ ./types/

RUN cargo build --release --bin dev-executor

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 nullspace

WORKDIR /app

COPY --from=builder /app/target/release/dev-executor /app/dev-executor

RUN chown -R nullspace:nullspace /app

USER nullspace

ENTRYPOINT ["/app/dev-executor"]
