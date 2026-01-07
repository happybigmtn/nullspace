# Project Management Domain Guide

## When This Applies
- Breaking down large initiatives
- Sprint/milestone planning
- Dependency mapping
- Progress tracking
- Resource allocation
- Risk assessment

---

## Task Decomposition Patterns

### Large Feature Planning
```
┌─────────────────────────────────────────────────────────────┐
│  1. SCOPE (parallel investigation)                          │
│                                                             │
│  Agent 1: Requirements Analysis                             │
│     • What exactly needs to be built?                      │
│     • What are the acceptance criteria?                    │
│     • What's explicitly out of scope?                      │
│                                                             │
│  Agent 2: Technical Investigation                           │
│     • What exists that we can build on?                    │
│     • What new components are needed?                      │
│     • What are the technical risks?                        │
│                                                             │
│  Agent 3: Dependency Mapping                                │
│     • What must happen first?                              │
│     • What can happen in parallel?                         │
│     • External dependencies?                               │
│                                                             │
│  2. DECOMPOSE                                               │
│     • Break into deliverable chunks                        │
│     • Each chunk independently valuable                    │
│     • Clear definition of done                             │
│                                                             │
│  3. SEQUENCE                                                │
│     • Order by dependencies                                │
│     • Identify parallelization opportunities               │
│     • Plan for unknowns                                    │
└─────────────────────────────────────────────────────────────┘
```

### Sprint Planning
```
┌─────────────────────────────────────────────────────────────┐
│  PARALLEL ASSESSMENT                                        │
│                                                             │
│  Agent 1: Backlog Analysis                                  │
│     • Priority items                                       │
│     • Dependencies                                         │
│     • Size estimates                                       │
│                                                             │
│  Agent 2: Capacity Check                                    │
│     • Available effort                                     │
│     • Ongoing commitments                                  │
│     • Buffer for unknowns                                  │
│                                                             │
│  Agent 3: Risk Review                                       │
│     • Technical risks                                      │
│     • External dependencies                                │
│     • Knowledge gaps                                       │
│                                                             │
│  SYNTHESIZE → Realistic sprint plan                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Agent Allocation

| PM Task | Model | Why |
|---------|-------|-----|
| List open issues/tasks | haiku | Simple extraction |
| Summarize requirements | haiku | Information gathering |
| Break down feature | sonnet | Structured decomposition |
| Estimate effort | sonnet | Pattern-based |
| Risk assessment | opus | Judgment required |
| Strategic planning | opus | Complex trade-offs |

---

## Quality Checklist

Good project plans have:
- [ ] Clear objective (what success looks like)
- [ ] Scope boundaries (what's NOT included)
- [ ] Dependencies mapped
- [ ] Risks identified with mitigations
- [ ] Milestones defined
- [ ] Definition of done for each item

---

## Decomposition Principles

### Good Task Breakdown
```
✅ Independently deliverable
✅ Testable
✅ Clear completion criteria
✅ Single responsibility
✅ Reasonable size (hours to days, not weeks)
```

### Bad Task Breakdown
```
❌ "Implement feature" (too vague)
❌ "Research" with no deliverable
❌ Dependent on unplanned work
❌ No clear done state
❌ Multi-week monolith
```

---

## Dependency Types

### Hard Dependencies
Must complete A before starting B
```
Example: Database schema before API endpoints
```

### Soft Dependencies
Prefer A before B, but can work around
```
Example: Design mockups before implementation
(can start with rough design)
```

### External Dependencies
Outside your control
```
Example: API access from third party
(plan for delays, have backup)
```

---

## Risk Assessment Framework

### Risk Matrix
| Impact ↓ / Likelihood → | Low | Medium | High |
|------------------------|-----|--------|------|
| High | Monitor | Plan mitigation | Active mitigation |
| Medium | Accept | Monitor | Plan mitigation |
| Low | Accept | Accept | Monitor |

### Common Risks
1. **Technical uncertainty** — Spike/prototype first
2. **External dependencies** — Early engagement, alternatives
3. **Scope creep** — Clear boundaries, change process
4. **Knowledge concentration** — Documentation, pairing
5. **Integration issues** — Early integration, contracts

---

## Common Pitfalls

1. **Planning too far ahead** — Detailed plans for distant work are fantasy
2. **Ignoring dependencies** — They don't go away
3. **No buffer** — Something always goes wrong
4. **Unclear done criteria** — "Done" means nothing without definition
5. **Not revisiting plans** — Plans are living documents
6. **Over-committing** — Under-promise, over-deliver
