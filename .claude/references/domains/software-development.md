# Software Development Domain Guide

## When This Applies
- Feature implementation
- Bug fixes
- Refactoring
- Code improvements
- New modules or components

---

## Task Decomposition Patterns

### New Feature
```
┌─────────────────────────────────────────────────────────────┐
│  1. UNDERSTAND (parallel)                                   │
│     • Explore existing patterns in codebase                │
│     • Find similar features to reference                   │
│     • Identify integration points                          │
│                                                             │
│  2. DESIGN (if complex)                                     │
│     • Data models                                          │
│     • API contracts                                        │
│     • Component boundaries                                 │
│                                                             │
│  3. IMPLEMENT (parallel where possible)                     │
│     • Core logic                                           │
│     • Tests                                                │
│     • Integration                                          │
│                                                             │
│  4. VERIFY                                                  │
│     • Run tests                                            │
│     • Check for regressions                                │
└─────────────────────────────────────────────────────────────┘
```

### Bug Fix
```
┌─────────────────────────────────────────────────────────────┐
│  1. REPRODUCE (parallel investigation)                      │
│     • Find the failing code path                           │
│     • Check related tests                                  │
│     • Look at recent changes (git history)                 │
│                                                             │
│  2. UNDERSTAND                                              │
│     • Root cause analysis                                  │
│     • Impact assessment                                    │
│                                                             │
│  3. FIX                                                     │
│     • Implement fix                                        │
│     • Add regression test                                  │
│                                                             │
│  4. VERIFY                                                  │
│     • Run full test suite                                  │
└─────────────────────────────────────────────────────────────┘
```

### Refactoring
```
┌─────────────────────────────────────────────────────────────┐
│  1. MAP (parallel)                                          │
│     • Find all usages of target code                       │
│     • Identify dependencies                                │
│     • Check test coverage                                  │
│                                                             │
│  2. PLAN                                                    │
│     • Define target architecture                           │
│     • Identify migration steps                             │
│                                                             │
│  3. EXECUTE (incremental)                                   │
│     • Small, testable changes                              │
│     • Maintain backward compatibility where needed         │
│                                                             │
│  4. CLEAN UP                                                │
│     • Remove dead code                                     │
│     • Update documentation                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Agent Allocation

| Task Type | Model | Why |
|-----------|-------|-----|
| Find existing patterns | haiku | Simple grep/glob |
| Read and summarize code | haiku | Mechanical |
| Implement well-defined function | sonnet | Clear scope |
| Write tests for existing code | sonnet | Pattern following |
| Design architecture | opus | Judgment required |
| Debug complex issue | opus | Reasoning across systems |
| Implement with ambiguity | opus | Needs to make decisions |

---

## Quality Checklist

Before marking complete, ensure:
- [ ] Tests pass
- [ ] No new warnings/errors
- [ ] Follows existing code style
- [ ] Edge cases handled
- [ ] Error messages are helpful
- [ ] No hardcoded values that should be config

---

## Common Pitfalls

1. **Starting implementation before understanding** — Always explore first
2. **Changing too much at once** — Small, focused changes
3. **Skipping tests** — Tests are not optional
4. **Not checking for existing solutions** — DRY applies to effort too
5. **Over-engineering** — Solve the problem at hand, not hypothetical future ones
