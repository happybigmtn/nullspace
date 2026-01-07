# Code Review Domain Guide

## When This Applies
- PR reviews
- Security audits
- Code quality assessment
- Architecture review
- Pre-merge checks

---

## Task Decomposition Patterns

### PR Review
```
┌─────────────────────────────────────────────────────────────┐
│  PARALLEL REVIEW STREAMS                                    │
│                                                             │
│  Agent 1: Correctness                                       │
│     • Does the code do what it claims?                     │
│     • Edge cases handled?                                  │
│     • Error handling complete?                             │
│                                                             │
│  Agent 2: Security                                          │
│     • Input validation                                     │
│     • Authentication/authorization                         │
│     • Data exposure risks                                  │
│     • Injection vulnerabilities                            │
│                                                             │
│  Agent 3: Quality                                           │
│     • Code style consistency                               │
│     • Naming clarity                                       │
│     • Duplication                                          │
│     • Complexity                                           │
│                                                             │
│  Agent 4: Testing                                           │
│     • Test coverage                                        │
│     • Test quality                                         │
│     • Missing scenarios                                    │
│                                                             │
│  SYNTHESIZE → Unified review with prioritized findings     │
└─────────────────────────────────────────────────────────────┘
```

### Security Audit
```
┌─────────────────────────────────────────────────────────────┐
│  COMPREHENSIVE SECURITY SCAN                                │
│                                                             │
│  Agent 1: Authentication & Authorization                    │
│  Agent 2: Input Validation & Injection                     │
│  Agent 3: Data Exposure & Privacy                          │
│  Agent 4: Cryptography & Secrets                           │
│  Agent 5: Dependencies & Supply Chain                      │
│                                                             │
│  Each agent produces severity-rated findings               │
│  Orchestrator synthesizes into prioritized report          │
└─────────────────────────────────────────────────────────────┘
```

---

## Agent Allocation

| Review Aspect | Model | Why |
|---------------|-------|-----|
| Find changed files | haiku | Simple lookup |
| Check style/formatting | haiku | Mechanical |
| Assess logic correctness | sonnet | Clear criteria |
| Evaluate test coverage | sonnet | Pattern matching |
| Security vulnerability analysis | opus | Requires reasoning |
| Architecture impact assessment | opus | Judgment calls |
| Subtle bug detection | opus | Complex reasoning |

---

## Review Quality Framework

### Severity Levels
- **Critical**: Security vulnerability, data loss risk, system crash
- **High**: Incorrect behavior, significant performance issue
- **Medium**: Code quality, maintainability concern
- **Low**: Style, minor improvements
- **Nitpick**: Suggestions, preferences (mark as such)

### Feedback Format
```
[SEVERITY] Category: Brief description

Problem: What's wrong and why it matters
Location: file:line
Suggestion: How to fix it (with code if helpful)
```

---

## Things to Always Check

### Security
- [ ] No hardcoded secrets
- [ ] Input validated before use
- [ ] SQL queries parameterized
- [ ] User data escaped in output
- [ ] Authentication on sensitive endpoints
- [ ] Authorization checks present

### Correctness
- [ ] Null/undefined handled
- [ ] Array bounds respected
- [ ] Async operations awaited
- [ ] Resources cleaned up
- [ ] Error states handled

### Quality
- [ ] No dead code
- [ ] No commented-out code
- [ ] Consistent naming
- [ ] Functions reasonably sized
- [ ] No magic numbers

---

## Common Pitfalls

1. **Being too harsh** — Focus on what matters, not style preferences
2. **Missing the forest for trees** — Look at design, not just details
3. **Not providing solutions** — Criticism without guidance isn't helpful
4. **Skipping tests** — Review tests as carefully as implementation
5. **Assuming context** — Ask if something seems wrong but you're not sure
