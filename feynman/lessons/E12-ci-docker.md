# E12 - CI images + Docker build chain (from scratch)

Focus files: `.github/workflows/build-images.yml`, `Dockerfile`

Goal: explain how CI builds container images and how the simulator Dockerfile is structured. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) CI image pipeline
CI builds images for every major service and pushes them to GHCR when changes land on main or a tag.

### 2) Multi-stage Docker builds
A multi-stage Dockerfile keeps the final image small by separating build dependencies from runtime.

### 3) Build caching
The pipeline uses BuildKit cache to speed up rebuilds by reusing layers.

---

## Limits & management callouts (important)

1) **Images are built on every push to main/master**
- This can be expensive; ensure CI budgets are monitored.

2) **Website build args depend on secrets**
- If secrets are missing, the website image may be misconfigured.

3) **Multi-stage Docker relies on stable Cargo.toml caching**
- Changes to workspace manifests invalidate build cache and slow CI.

---

## Walkthrough with code excerpts

### 1) CI matrix for images
```rust
strategy:
  fail-fast: false
  matrix:
    include:
      - id: simulator
        dockerfile: ./Dockerfile
        context: .
        image: nullspace-simulator
      - id: node
        dockerfile: ./node/Dockerfile
        context: .
        image: nullspace-node
      - id: gateway
        dockerfile: ./gateway/Dockerfile
        context: .
        image: nullspace-gateway
      - id: auth
        dockerfile: ./services/auth/Dockerfile
        context: .
        image: nullspace-auth
      - id: live-table
        dockerfile: ./services/live-table/Dockerfile
        context: .
        image: nullspace-live-table
```

Why this matters:
- This defines which services are shipped as Docker images.

What this code does:
- Builds a matrix of services, each with its own Dockerfile and image name.

---

### 2) Build and push step
```rust
- name: Build and push
  uses: docker/build-push-action@v6
  with:
    context: ${{ matrix.context }}
    file: ${{ matrix.dockerfile }}
    push: ${{ github.event_name != 'pull_request' }}
    tags: ${{ steps.meta.outputs.tags }}
    labels: ${{ steps.meta.outputs.labels }}
    build-args: ${{ matrix.build_args || '' }}
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

Why this matters:
- This step determines whether images are published or just built for verification.

What this code does:
- Builds each image in the matrix.
- Pushes only on non-PR events.
- Uses GitHub Actions cache to speed up builds.

---

### 3) Multi-stage Rust build (simulator)
```rust
FROM rust:1.83-slim-bookworm AS builder

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

RUN cargo build --release --package nullspace-simulator 2>/dev/null || true
```

Why this matters:
- This is the cache-optimized build pattern that makes Rust builds feasible in CI.

What this code does:
- Copies only Cargo manifests first to maximize cache reuse.
- Builds dummy sources to prime the dependency cache.
- Later layers copy real source and build the final binary.

---

## Key takeaways
- CI builds a matrix of service images on each push.
- Multi-stage Docker keeps runtime images small.
- Build cache settings are crucial for fast CI cycles.

## Next lesson
E13 - Systemd + service orchestration: `feynman/lessons/E13-systemd-services.md`
