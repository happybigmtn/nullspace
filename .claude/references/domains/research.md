# Research Domain Guide

## When This Applies
- Codebase exploration
- Understanding existing systems
- Finding patterns and conventions
- Answering "how does X work?"
- Technology investigation

---

## Task Decomposition Patterns

### Codebase Understanding
```
┌─────────────────────────────────────────────────────────────┐
│  PARALLEL EXPLORATION                                       │
│                                                             │
│  Agent 1: Structure                                         │
│     • Directory layout                                     │
│     • Key files (package.json, Cargo.toml, etc.)          │
│     • Entry points                                         │
│                                                             │
│  Agent 2: Patterns                                          │
│     • Code conventions                                     │
│     • Common abstractions                                  │
│     • Error handling style                                 │
│                                                             │
│  Agent 3: Dependencies                                      │
│     • External libraries                                   │
│     • Internal module relationships                        │
│     • Build system                                         │
│                                                             │
│  Agent 4: Documentation                                     │
│     • README files                                         │
│     • Code comments                                        │
│     • API docs                                             │
│                                                             │
│  SYNTHESIZE → Comprehensive codebase overview              │
└─────────────────────────────────────────────────────────────┘
```

### "How Does X Work?"
```
┌─────────────────────────────────────────────────────────────┐
│  TARGETED INVESTIGATION                                     │
│                                                             │
│  Agent 1: Entry Point                                       │
│     • Where is X invoked?                                  │
│     • What triggers it?                                    │
│                                                             │
│  Agent 2: Implementation                                    │
│     • Core logic of X                                      │
│     • Data flow                                            │
│                                                             │
│  Agent 3: Dependencies                                      │
│     • What does X call?                                    │
│     • What calls X?                                        │
│                                                             │
│  Agent 4: Tests                                             │
│     • How is X tested?                                     │
│     • What behaviors are verified?                         │
│                                                             │
│  SYNTHESIZE → Clear explanation with examples              │
└─────────────────────────────────────────────────────────────┘
```

### Technology Investigation
```
┌─────────────────────────────────────────────────────────────┐
│  MULTI-SOURCE RESEARCH                                      │
│                                                             │
│  Agent 1: Official Documentation                            │
│     • API reference                                        │
│     • Getting started guides                               │
│                                                             │
│  Agent 2: Examples                                          │
│     • Code samples                                         │
│     • Common patterns                                      │
│                                                             │
│  Agent 3: Community                                         │
│     • Stack Overflow solutions                             │
│     • GitHub issues/discussions                            │
│                                                             │
│  Agent 4: Codebase Usage                                    │
│     • How is it used in THIS project?                      │
│     • Existing patterns to follow                          │
│                                                             │
│  SYNTHESIZE → Actionable knowledge for implementation      │
└─────────────────────────────────────────────────────────────┘
```

---

## Agent Allocation

| Research Task | Model | Why |
|---------------|-------|-----|
| List files/directories | haiku | Simple glob |
| Grep for patterns | haiku | Mechanical search |
| Read and summarize file | haiku | Information extraction |
| Trace execution flow | sonnet | Following logic |
| Explain architecture | sonnet | Pattern recognition |
| Synthesize across sources | opus | Judgment and integration |
| Recommend approach | opus | Decision making |

---

## Research Quality Checklist

Good research output includes:
- [ ] Clear answer to the question asked
- [ ] File paths for all referenced code
- [ ] Code snippets for key concepts
- [ ] Confidence level (certain/likely/unclear)
- [ ] Gaps identified (what couldn't be determined)

---

## Search Strategies

### Finding Code
```
1. Start with obvious names (grep for "login", "auth", etc.)
2. Check entry points (main, index, routes)
3. Follow imports/dependencies
4. Check tests for behavior documentation
5. Look at git history for context
```

### Understanding Flow
```
1. Find the entry point
2. Trace forward (what does it call?)
3. Trace backward (what calls it?)
4. Map data transformations
5. Identify side effects
```

### Finding Patterns
```
1. Sample multiple instances of similar code
2. Identify commonalities
3. Note variations and why they exist
4. Document the "right" way
```

---

## Common Pitfalls

1. **Stopping at surface level** — Dig deeper than obvious answers
2. **Missing the tests** — Tests often document intent better than code
3. **Ignoring git history** — Context for why things are the way they are
4. **Not verifying** — Confirm findings with multiple sources
5. **Information overload** — Synthesize, don't just dump everything
