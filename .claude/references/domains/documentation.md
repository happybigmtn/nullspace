# Documentation Domain Guide

## When This Applies
- Writing READMEs
- API documentation
- Code comments
- Architecture docs
- User guides
- Changelogs

---

## Task Decomposition Patterns

### README Creation
```
┌─────────────────────────────────────────────────────────────┐
│  PARALLEL RESEARCH                                          │
│                                                             │
│  Agent 1: Project Understanding                             │
│     • What does this do?                                   │
│     • Who is it for?                                       │
│     • What problem does it solve?                          │
│                                                             │
│  Agent 2: Setup & Installation                              │
│     • Dependencies                                         │
│     • Build steps                                          │
│     • Configuration                                        │
│                                                             │
│  Agent 3: Usage Patterns                                    │
│     • Common use cases                                     │
│     • Example code                                         │
│     • CLI commands                                         │
│                                                             │
│  Agent 4: API Surface                                       │
│     • Key functions/classes                                │
│     • Parameters and returns                               │
│     • Common patterns                                      │
│                                                             │
│  SYNTHESIZE → Well-structured README                       │
└─────────────────────────────────────────────────────────────┘
```

### API Documentation
```
┌─────────────────────────────────────────────────────────────┐
│  PARALLEL DOCUMENTATION                                     │
│                                                             │
│  Agent per module/endpoint:                                 │
│     • Extract signatures                                   │
│     • Document parameters                                  │
│     • Provide examples                                     │
│     • Note edge cases                                      │
│                                                             │
│  SYNTHESIZE → Consistent API reference                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Agent Allocation

| Documentation Task | Model | Why |
|-------------------|-------|-----|
| Extract function signatures | haiku | Mechanical |
| List configuration options | haiku | Simple extraction |
| Write usage examples | sonnet | Pattern following |
| Document API endpoint | sonnet | Structured task |
| Write conceptual overview | opus | Requires understanding |
| Architecture documentation | opus | Big picture thinking |

---

## Documentation Quality Checklist

Good documentation has:
- [ ] Clear purpose statement (what and why)
- [ ] Quick start (get running in <5 minutes)
- [ ] Working code examples
- [ ] API reference (complete)
- [ ] Common pitfalls / FAQ
- [ ] Contribution guidelines (if open source)

---

## README Structure

```markdown
# Project Name

One-line description of what this does.

## Quick Start

Minimal steps to get running.

## Installation

Detailed setup instructions.

## Usage

Common use cases with examples.

## API Reference

Functions, classes, endpoints.

## Configuration

Environment variables, config files.

## Development

How to contribute, run tests.

## License

Legal stuff.
```

---

## Writing Principles

### Be Concise
- Say it once, say it clearly
- Code examples > prose explanations
- Tables for structured information

### Be Accurate
- Test all code examples
- Keep in sync with code changes
- Date or version documentation

### Be Helpful
- Anticipate questions
- Provide context for decisions
- Link to deeper resources

---

## Common Pitfalls

1. **Writing for yourself** — Document for someone who doesn't know the code
2. **Too much detail** — Nobody reads walls of text
3. **Stale examples** — Broken examples are worse than none
4. **Missing the "why"** — Context matters as much as mechanics
5. **Assuming knowledge** — Define terms, explain prerequisites
6. **Not maintaining** — Documentation is code; it needs updates
