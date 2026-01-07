# Orchestration Patterns

Common patterns for decomposing and parallelizing work.

---

## Fan-Out / Fan-In

**Use when:** Multiple independent investigations feed into a synthesis.

```
                    ┌─────────┐
                    │ Request │
                    └────┬────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
    ┌─────────┐    ┌─────────┐    ┌─────────┐
    │ Agent 1 │    │ Agent 2 │    │ Agent 3 │
    │ (haiku) │    │ (haiku) │    │ (haiku) │
    └────┬────┘    └────┬────┘    └────┬────┘
         │               │               │
         └───────────────┼───────────────┘
                         │
                         ▼
                  ┌─────────────┐
                  │  Synthesize │
                  │   (you)     │
                  └─────────────┘
```

**Example:** Understanding a codebase
- Agent 1: Structure and entry points
- Agent 2: Patterns and conventions
- Agent 3: Dependencies and build system
- Synthesis: Comprehensive overview

---

## Pipeline

**Use when:** Work must flow through stages, each depending on prior.

```
    ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
    │ Stage 1 │ ──▶ │ Stage 2 │ ──▶ │ Stage 3 │ ──▶ │ Stage 4 │
    │  haiku  │     │ sonnet  │     │ sonnet  │     │  opus   │
    └─────────┘     └─────────┘     └─────────┘     └─────────┘
       Find           Design         Implement        Review
```

**Example:** Feature implementation
1. Find existing patterns (haiku)
2. Design approach (sonnet)
3. Implement (sonnet)
4. Review and polish (opus)

---

## Parallel Pipelines

**Use when:** Multiple independent workstreams converge at the end.

```
    ┌─────────┐     ┌─────────┐
    │   A.1   │ ──▶ │   A.2   │ ──┐
    └─────────┘     └─────────┘   │
                                  │
    ┌─────────┐     ┌─────────┐   │    ┌─────────────┐
    │   B.1   │ ──▶ │   B.2   │ ──┼──▶ │  Integrate  │
    └─────────┘     └─────────┘   │    └─────────────┘
                                  │
    ┌─────────┐     ┌─────────┐   │
    │   C.1   │ ──▶ │   C.2   │ ──┘
    └─────────┘     └─────────┘
```

**Example:** Building multiple components
- Stream A: Auth routes
- Stream B: User routes
- Stream C: Admin routes
- Integration: Wire everything together

---

## Scout / Build

**Use when:** Need to explore before committing to approach.

```
    ┌─────────────────────────────────────────────────┐
    │              SCOUT PHASE (haiku swarm)          │
    │                                                 │
    │  ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌────┐       │
    │  │ S1 │  │ S2 │  │ S3 │  │ S4 │  │ S5 │       │
    │  └────┘  └────┘  └────┘  └────┘  └────┘       │
    │                                                 │
    └─────────────────────┬───────────────────────────┘
                          │
                          ▼
                   ┌─────────────┐
                   │   Decide    │
                   │    (you)    │
                   └──────┬──────┘
                          │
                          ▼
    ┌─────────────────────────────────────────────────┐
    │             BUILD PHASE (sonnet/opus)           │
    │                                                 │
    │  ┌────────┐  ┌────────┐  ┌────────┐           │
    │  │ Build1 │  │ Build2 │  │ Build3 │           │
    │  └────────┘  └────────┘  └────────┘           │
    │                                                 │
    └─────────────────────────────────────────────────┘
```

**Example:** Bug fix
- Scout: Find the bug, check tests, review history
- Decide: Identify root cause, plan fix
- Build: Implement fix, add test, verify

---

## Competitive Evaluation

**Use when:** Multiple approaches possible, want to compare.

```
    ┌─────────────────────────────────────────────────┐
    │           PARALLEL APPROACHES                   │
    │                                                 │
    │  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
    │  │Approach A│  │Approach B│  │Approach C│     │
    │  │  opus    │  │  opus    │  │  opus    │     │
    │  └────┬─────┘  └────┬─────┘  └────┬─────┘     │
    │       │             │             │           │
    └───────┼─────────────┼─────────────┼───────────┘
            │             │             │
            └─────────────┼─────────────┘
                          │
                          ▼
                   ┌─────────────┐
                   │   Compare   │
                   │    (you)    │
                   └─────────────┘
```

**Example:** Architecture decision
- Approach A: Microservices
- Approach B: Monolith with modules
- Approach C: Serverless
- Compare: Trade-offs, recommend

---

## Incremental Refinement

**Use when:** Building on successive feedback.

```
    ┌─────────┐     ┌─────────┐     ┌─────────┐
    │ Draft 1 │ ──▶ │ Review  │ ──▶ │ Draft 2 │ ──▶ ...
    │ sonnet  │     │  opus   │     │ sonnet  │
    └─────────┘     └─────────┘     └─────────┘
```

**Example:** Complex implementation
1. Initial implementation (sonnet)
2. Review for issues (opus)
3. Refined implementation (sonnet)
4. Final review (opus)

---

## Pattern Selection Guide

| Situation | Pattern | Why |
|-----------|---------|-----|
| Need info from multiple sources | Fan-Out/Fan-In | Parallel gathering |
| Sequential dependencies | Pipeline | Each step needs prior |
| Independent workstreams | Parallel Pipelines | Maximum parallelism |
| Unknown territory | Scout/Build | Explore before commit |
| Multiple valid approaches | Competitive Eval | Compare options |
| Complex, iterative work | Incremental Refinement | Build quality progressively |

---

## Anti-Patterns

### Sequential Everything
```
❌ Agent 1 ──▶ Agent 2 ──▶ Agent 3 ──▶ Agent 4
```
**Problem:** Slow. Each waits for prior.
**Fix:** Identify what can run in parallel.

### Single Agent
```
❌ One agent does everything
```
**Problem:** No parallelism, bottleneck.
**Fix:** Decompose into parallel tasks.

### Over-Orchestration
```
❌ Agent for every tiny task
```
**Problem:** Coordination overhead exceeds benefit.
**Fix:** Batch small related tasks together.
