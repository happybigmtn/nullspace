# Build stage
FROM rust:1.88-slim-bookworm AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace configuration first for better caching
COPY Cargo.toml Cargo.lock ./
COPY node/Cargo.toml ./node/
COPY client/Cargo.toml ./client/
COPY execution/Cargo.toml ./execution/
COPY simulator/Cargo.toml ./simulator/
COPY types/Cargo.toml ./types/
COPY website/wasm/Cargo.toml ./website/wasm/

# Create dummy source files to build dependencies
RUN mkdir -p node/src client/src execution/src simulator/src types/src website/wasm/src && \
    echo "fn main() {}" > node/src/main.rs && \
    echo "fn main() {}" > client/src/main.rs && \
    echo "pub fn placeholder() {}" > execution/src/lib.rs && \
    echo "fn main() {}" > simulator/src/main.rs && \
    echo "pub fn placeholder() {}" > types/src/lib.rs && \
    echo "pub fn placeholder() {}" > website/wasm/src/lib.rs

# Build dependencies (this layer will be cached)
RUN cargo build --release --package nullspace-simulator 2>/dev/null || true

# Remove dummy source files
RUN rm -rf node/src client/src execution/src simulator/src types/src website/wasm/src

# Copy actual source code
COPY node/ ./node/
COPY client/ ./client/
COPY execution/ ./execution/
COPY simulator/ ./simulator/
COPY types/ ./types/
COPY website/wasm/ ./website/wasm/
COPY terminal-cli/ ./terminal-cli/

# Build the actual binary
RUN cargo build --release --package nullspace-simulator

# Runtime stage
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -u 1000 nullspace

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/target/release/nullspace-simulator /app/nullspace-simulator

# Set ownership
RUN chown -R nullspace:nullspace /app

USER nullspace

# Expose API port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/healthz || exit 1

# Default command
ENTRYPOINT ["/app/nullspace-simulator"]
