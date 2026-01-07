# DevOps Domain Guide

## When This Applies
- CI/CD pipeline work
- Deployment configuration
- Infrastructure as code
- Docker/container work
- Environment setup
- Monitoring and logging

---

## Task Decomposition Patterns

### CI/CD Pipeline
```
┌─────────────────────────────────────────────────────────────┐
│  PARALLEL INVESTIGATION                                     │
│                                                             │
│  Agent 1: Current Setup                                     │
│     • Existing pipeline files                              │
│     • Build scripts                                        │
│     • Test configuration                                   │
│                                                             │
│  Agent 2: Requirements                                      │
│     • Build dependencies                                   │
│     • Test requirements                                    │
│     • Deployment targets                                   │
│                                                             │
│  Agent 3: Secrets & Config                                  │
│     • Environment variables needed                         │
│     • Secret management                                    │
│     • Per-environment config                               │
│                                                             │
│  IMPLEMENT → Pipeline configuration                        │
│  VERIFY → Test in staging/preview                          │
└─────────────────────────────────────────────────────────────┘
```

### Dockerfile/Container
```
┌─────────────────────────────────────────────────────────────┐
│  1. UNDERSTAND                                              │
│     • Application requirements                             │
│     • Runtime dependencies                                 │
│     • Build process                                        │
│                                                             │
│  2. RESEARCH (parallel)                                     │
│     • Best base image                                      │
│     • Security best practices                              │
│     • Existing patterns in project                         │
│                                                             │
│  3. IMPLEMENT                                               │
│     • Multi-stage build                                    │
│     • Minimize layers                                      │
│     • Security hardening                                   │
│                                                             │
│  4. VERIFY                                                  │
│     • Build succeeds                                       │
│     • Container runs                                       │
│     • Size is reasonable                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Agent Allocation

| DevOps Task | Model | Why |
|-------------|-------|-----|
| Find config files | haiku | Simple search |
| List environment variables | haiku | Extraction |
| Write Dockerfile | sonnet | Pattern following |
| Write CI config | sonnet | Structured task |
| Debug deployment issue | opus | Complex reasoning |
| Design infrastructure | opus | Architecture decisions |

---

## Quality Checklist

### CI/CD Pipeline
- [ ] Runs on every PR
- [ ] Fails fast (lint/format first)
- [ ] Caches dependencies
- [ ] Parallel where possible
- [ ] Clear failure messages
- [ ] Secrets not exposed in logs

### Dockerfile
- [ ] Multi-stage build
- [ ] Non-root user
- [ ] Minimal base image
- [ ] .dockerignore present
- [ ] No secrets in image
- [ ] Health check defined

### Deployment
- [ ] Rollback plan exists
- [ ] Health checks configured
- [ ] Logs accessible
- [ ] Monitoring in place
- [ ] Secrets properly managed

---

## Common Patterns

### CI Pipeline Stages
```
1. Lint & Format Check (fastest, fail first)
2. Build
3. Unit Tests
4. Integration Tests
5. Security Scan
6. Deploy to Staging
7. E2E Tests
8. Deploy to Production
```

### Dockerfile Best Practices
```dockerfile
# Multi-stage build
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
# Non-root user
RUN adduser --disabled-password appuser
USER appuser
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
HEALTHCHECK CMD curl -f http://localhost:3000/health || exit 1
CMD ["node", "dist/index.js"]
```

---

## Common Pitfalls

1. **Secrets in code/images** — Use secret managers
2. **No caching** — Builds shouldn't redownload everything
3. **Flaky pipelines** — Fix reliability issues immediately
4. **Manual steps** — Automate everything repeatable
5. **No rollback plan** — Always know how to undo
6. **Missing health checks** — Systems should self-report status
