# Testing Domain Guide

## When This Applies
- Writing new tests
- Improving test coverage
- Test refactoring
- Test debugging
- Test strategy design

---

## Task Decomposition Patterns

### Add Tests for Existing Code
```
┌─────────────────────────────────────────────────────────────┐
│  1. UNDERSTAND (parallel)                                   │
│                                                             │
│  Agent 1: Analyze the code                                  │
│     • What does it do?                                     │
│     • What are the inputs/outputs?                         │
│     • What can go wrong?                                   │
│                                                             │
│  Agent 2: Find existing tests                              │
│     • Test patterns in this codebase                       │
│     • Testing utilities available                          │
│     • Mock/fixture conventions                             │
│                                                             │
│  Agent 3: Identify scenarios                               │
│     • Happy path                                           │
│     • Edge cases                                           │
│     • Error conditions                                     │
│                                                             │
│  2. IMPLEMENT (can be parallel per scenario group)         │
│                                                             │
│  Agent 4+: Write tests following identified patterns       │
│                                                             │
│  3. VERIFY                                                  │
│     • Run tests                                            │
│     • Check coverage                                       │
└─────────────────────────────────────────────────────────────┘
```

### Improve Test Coverage
```
┌─────────────────────────────────────────────────────────────┐
│  1. MEASURE                                                 │
│     • Run coverage tool                                    │
│     • Identify uncovered code                              │
│                                                             │
│  2. PRIORITIZE                                              │
│     • Critical paths first                                 │
│     • Complex logic                                        │
│     • Recently buggy areas                                 │
│                                                             │
│  3. IMPLEMENT (parallel by module)                         │
│     • Each agent tackles a module                          │
│     • Follow existing patterns                             │
│                                                             │
│  4. VERIFY                                                  │
│     • Re-run coverage                                      │
│     • Ensure tests are meaningful, not just coverage       │
└─────────────────────────────────────────────────────────────┘
```

---

## Agent Allocation

| Testing Task | Model | Why |
|--------------|-------|-----|
| Find existing tests | haiku | Simple search |
| List uncovered lines | haiku | Coverage tool output |
| Write unit test for simple function | sonnet | Pattern following |
| Write integration test | sonnet | Clear scope |
| Design test strategy | opus | Judgment required |
| Test complex edge cases | opus | Requires understanding |
| Debug flaky test | opus | Complex reasoning |

---

## Test Quality Checklist

Good tests have:
- [ ] Clear, descriptive names
- [ ] Single concern per test
- [ ] Arrange-Act-Assert structure
- [ ] No dependencies between tests
- [ ] Fast execution
- [ ] Meaningful assertions (not just "no error")

---

## Test Scenario Categories

### Always Test
1. **Happy path** — Normal, expected usage
2. **Empty/null inputs** — What happens with nothing?
3. **Boundary values** — Min, max, just under, just over
4. **Invalid inputs** — Malformed, wrong type, out of range
5. **Error conditions** — Network failure, missing resource

### Often Overlooked
- Concurrent access
- Order dependencies
- Resource cleanup
- Timeout behavior
- Partial failure states

---

## Testing Patterns by Type

### Unit Tests
```
- Test one function/method in isolation
- Mock external dependencies
- Fast, deterministic
- Many of these
```

### Integration Tests
```
- Test components working together
- Real dependencies where practical
- Slower, but more confidence
- Fewer, covering key flows
```

### End-to-End Tests
```
- Test full user scenarios
- Real environment
- Slowest, most brittle
- Fewest, only critical paths
```

---

## Common Pitfalls

1. **Testing implementation, not behavior** — Tests should survive refactoring
2. **Over-mocking** — If everything is mocked, what are you testing?
3. **Flaky tests** — Fix or delete; never ignore
4. **Test data coupling** — Tests shouldn't depend on specific data
5. **Assertion-free tests** — Running without crashing isn't a test
6. **Copy-paste tests** — Extract common setup, vary what matters
