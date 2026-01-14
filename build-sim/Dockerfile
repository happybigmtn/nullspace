FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates libssl3 libsqlite3-0 && rm -rf /var/lib/apt/lists/*
COPY nullspace-simulator /app/nullspace-simulator
ENTRYPOINT ["/app/nullspace-simulator"]
