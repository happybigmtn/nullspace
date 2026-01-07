# Workflow Examples

Real-world examples of orchestration patterns in action.

---

## Example 1: "Add a login feature"

### User Request
> "Add user login to the app"

### Orchestrator Response
```
Love it. Let me get a feel for your codebase and figure out the best approach.
```

### Phase 1: Scout (parallel haiku agents)

```python
# Spawn simultaneously
Task(
    subagent_type="Explore",
    description="Find auth patterns",
    prompt="""CONTEXT: You are a WORKER agent...

TASK: Find any existing authentication code in this codebase.
- Look for: auth, login, session, jwt, token
- Check: routes, middleware, services
- Report: file paths, patterns used""",
    model="haiku",
    run_in_background=True
)

Task(
    subagent_type="Explore",
    description="Find user model",
    prompt="""CONTEXT: You are a WORKER agent...

TASK: Find the user model/schema in this codebase.
- Look for: User, Account, Profile models
- Check: models/, schemas/, types/
- Report: file paths, fields defined""",
    model="haiku",
    run_in_background=True
)

Task(
    subagent_type="Explore",
    description="Find route patterns",
    prompt="""CONTEXT: You are a WORKER agent...

TASK: Find the routing patterns in this codebase.
- Look for: routes, controllers, handlers
- Check: how endpoints are defined
- Report: patterns, file structure""",
    model="haiku",
    run_in_background=True
)
```

### Phase 2: Design (opus agent)

After scouts complete:
```python
Task(
    subagent_type="general-purpose",
    description="Design auth system",
    prompt="""CONTEXT: You are a WORKER agent...

TASK: Design an authentication system for this codebase.

EXISTING PATTERNS:
[Synthesized scout findings here]

REQUIREMENTS:
- POST /login - email/password authentication
- POST /logout - end session
- Middleware for protected routes

OUTPUT:
- Data models needed
- API contracts
- File structure
- Implementation steps""",
    model="opus",
    run_in_background=True
)
```

### Phase 3: Implement (parallel sonnet agents)

```python
# Based on design, spawn implementation agents
Task(
    subagent_type="general-purpose",
    description="Create auth routes",
    prompt="""CONTEXT: You are a WORKER agent...

TASK: Create src/routes/auth.ts with:
- POST /login handler
- POST /logout handler
- Follow patterns from [existing route file]
- Use bcrypt for password hashing
- Use jsonwebtoken for JWT""",
    model="sonnet",
    run_in_background=True
)

Task(
    subagent_type="general-purpose",
    description="Create auth middleware",
    prompt="""CONTEXT: You are a WORKER agent...

TASK: Create src/middleware/auth.ts with:
- requireAuth middleware that validates JWT
- Follow patterns from [existing middleware]
- Return 401 if no valid token""",
    model="sonnet",
    run_in_background=True
)

Task(
    subagent_type="general-purpose",
    description="Create auth tests",
    prompt="""CONTEXT: You are a WORKER agent...

TASK: Create tests for auth system:
- Login success and failure
- Logout
- Protected route access
- Follow test patterns from [existing tests]""",
    model="sonnet",
    run_in_background=True
)
```

### Phase 4: Verify

```python
Task(
    subagent_type="general-purpose",
    description="Run auth tests",
    prompt="""CONTEXT: You are a WORKER agent...

TASK: Run the test suite and report results.
- npm test or equivalent
- Report any failures
- Check for TypeScript errors""",
    model="haiku",
    run_in_background=True
)
```

### Final Synthesis

```
╭──────────────────────────────────────────────────╮
│                                                  │
│  ✨ Login Feature Complete                       │
│                                                  │
│  Created:                                        │
│  • src/routes/auth.ts - login/logout endpoints  │
│  • src/middleware/auth.ts - JWT validation      │
│  • tests/auth.test.ts - full test coverage      │
│                                                  │
│  All tests passing. Ready to use.               │
│                                                  │
╰──────────────────────────────────────────────────╯
```

---

## Example 2: "Why is this endpoint slow?"

### User Request
> "The /api/users endpoint is really slow, can you figure out why?"

### Orchestrator Response
```
On it. Let me investigate from a few angles.
```

### Parallel Investigation

```python
Task(
    subagent_type="Explore",
    description="Find users endpoint",
    prompt="""CONTEXT: You are a WORKER agent...

TASK: Find the /api/users endpoint implementation.
- Locate the route handler
- Trace what it calls
- Report the full call chain""",
    model="haiku",
    run_in_background=True
)

Task(
    subagent_type="Explore",
    description="Check database queries",
    prompt="""CONTEXT: You are a WORKER agent...

TASK: Find database queries related to users.
- Look for: SQL, ORM calls, find/select operations
- Check for: N+1 queries, missing indexes, large result sets
- Report: query patterns found""",
    model="sonnet",
    run_in_background=True
)

Task(
    subagent_type="general-purpose",
    description="Analyze performance",
    prompt="""CONTEXT: You are a WORKER agent...

TASK: Analyze the users endpoint for performance issues.
- Check for: unnecessary loops, blocking calls, inefficient algorithms
- Look at: data transformations, serialization
- Report: potential bottlenecks""",
    model="opus",
    run_in_background=True
)
```

### Synthesis

```
Found the issue. The /api/users endpoint at src/routes/users.ts:45
is doing an N+1 query pattern.

For each user, it's making a separate database call to fetch their
profile. With 100 users, that's 101 queries.

**Quick fix:** Use eager loading:
```typescript
// Before
const users = await User.findAll();
users.forEach(u => u.profile = await Profile.findOne({userId: u.id}));

// After
const users = await User.findAll({ include: [Profile] });
```

Want me to implement this fix?
```

---

## Example 3: "Review this PR"

### User Request
> "Can you review PR #123?"

### Parallel Review Streams

```python
Task(
    subagent_type="general-purpose",
    description="Review correctness",
    prompt="""CONTEXT: You are a WORKER agent...

TASK: Review PR #123 for correctness.
- Does the code do what it claims?
- Are edge cases handled?
- Is error handling complete?

OUTPUT: List of findings with severity and location""",
    model="opus",
    run_in_background=True
)

Task(
    subagent_type="general-purpose",
    description="Review security",
    prompt="""CONTEXT: You are a WORKER agent...

TASK: Review PR #123 for security issues.
- Input validation
- Authentication/authorization
- Data exposure
- Injection vulnerabilities

OUTPUT: Security findings with severity""",
    model="opus",
    run_in_background=True
)

Task(
    subagent_type="general-purpose",
    description="Review tests",
    prompt="""CONTEXT: You are a WORKER agent...

TASK: Review test coverage in PR #123.
- Are new features tested?
- Are edge cases covered?
- Test quality assessment

OUTPUT: Testing findings and gaps""",
    model="sonnet",
    run_in_background=True
)
```

### Synthesized Review

```
## PR #123 Review Summary

### 🔴 Critical
**Security: SQL Injection in search**
Location: src/api/search.ts:34
The query parameter is interpolated directly into SQL.
Fix: Use parameterized queries.

### 🟡 Medium
**Missing null check**
Location: src/services/user.ts:78
Will throw if user not found.
Fix: Add null check before accessing properties.

### 🟢 Minor
**Test gap**
The new search feature lacks tests for empty results.
Suggest: Add test case for no matches.

### ✅ Good
- Clean code structure
- Consistent naming
- Good use of existing patterns

**Recommendation:** Address critical security issue before merging.
```

---

## Pattern Recap

| Scenario | Pattern | Agents |
|----------|---------|--------|
| New feature | Scout → Design → Implement → Verify | haiku → opus → sonnet → haiku |
| Debug/investigate | Parallel investigation | mix based on task |
| Code review | Parallel review streams | opus for judgment calls |
| Quick fix | Scout → Implement | haiku → sonnet |
| Research question | Fan-out investigation | haiku swarm |
