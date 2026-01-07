# User Guide: Working with the Orchestrator

This guide explains what to expect when working with the orchestrator.

---

## What the Orchestrator Does

The orchestrator is your intelligent companion for software engineering tasks. Instead of working linearly, it breaks your requests into parallel workstreams, coordinating multiple specialist agents to deliver results faster and more thoroughly.

**Think of it like:** A skilled project manager with a team of experts on speed dial.

---

## How It Works

```
    Your Request
         │
         ▼
    ┌─────────────┐
    │ Orchestrator│ ← Understands, decomposes, coordinates
    └──────┬──────┘
           │
    ┌──────┴──────┐
    │             │
    ▼             ▼
┌───────┐   ┌───────┐
│Agent 1│   │Agent 2│ ... (working in parallel)
└───────┘   └───────┘
    │             │
    └──────┬──────┘
           │
           ▼
    ┌─────────────┐
    │   Results   │ ← Synthesized into clear answer
    └─────────────┘
```

---

## What to Expect

### Quick Acknowledgment
Your request is received and understood. The orchestrator communicates clearly about what it's doing.

### Parallel Progress
Multiple aspects of your request are being worked on simultaneously. You'll see progress updates.

### Thorough Results
Answers come from multiple angles, catching things you might not have asked about explicitly.

### Celebratory Delivery
When things come together, it feels good. Milestones are acknowledged.

---

## Tips for Best Results

### Be Clear About Outcomes
Tell the orchestrator what you want to achieve, not how to achieve it.

```
✅ "Add user authentication to the app"
✅ "Figure out why the dashboard is slow"
✅ "Review this PR for security issues"

❌ "Read file X, then read file Y, then..."
```

### Provide Context When Helpful
If you know something relevant, share it.

```
✅ "The login bug started after last week's deploy"
✅ "We're using PostgreSQL, not MySQL"
✅ "This needs to work with our existing auth system"
```

### Scope Appropriately
The orchestrator works best with clear scope. For ambiguous requests, expect clarifying questions.

```
✅ "Add a password reset feature"
✅ "Optimize the database queries in the user service"

? "Make the app better" (expect: "What aspect should I focus on?")
? "Fix things" (expect: "What's broken?")
```

---

## Common Scenarios

### Feature Request
> "Add X feature"

Expect: Questions about scope if ambiguous, then parallel implementation with tests and documentation.

### Bug Investigation
> "Why is X broken?"

Expect: Parallel investigation from multiple angles, then clear diagnosis and suggested fix.

### Code Review
> "Review this PR/code"

Expect: Parallel review for correctness, security, quality, and testing, then synthesized findings.

### Understanding Code
> "How does X work?"

Expect: Thorough investigation including implementation, usages, tests, and history.

### Refactoring
> "Refactor X to be better"

Expect: Understanding current state, planning improvements, incremental implementation.

---

## Communication Style

The orchestrator maintains a friendly, confident tone. Expect:

- **Warmth:** "Love it. Let's build this."
- **Confidence:** "I've got this. Here's how we'll tackle it."
- **Progress Updates:** "Got a few threads running on this..."
- **Celebration:** Clear acknowledgment when work completes.

**You won't see:**
- Technical jargon about "subagents" or "pipelines"
- Cold, robotic responses
- Excessive verbosity or filler

---

## Clarifying Questions

When scope is unclear, the orchestrator asks smart questions:

- Multiple choice format
- Rich descriptions explaining trade-offs
- Usually 2-4 questions covering key dimensions

**Why this matters:** Better questions up front = better results faster.

---

## Progress Indicators

The orchestrator's signature shows current status:

```
─── ◈ Orchestrating ────────────────────────────
```

With context:
```
─── ◈ Orchestrating ── 4 agents working ────────
```

On completion:
```
─── ◈ Complete ─────────────────────────────────
```

---

## What to Do If...

### Results seem wrong
Just say so. The orchestrator can investigate further or try a different approach.

### You want to change direction
No problem. State the new direction clearly.

### Something is taking too long
Ask for status. Complex tasks legitimately take time, but stuck processes can be investigated.

### You have additional context
Share it. More context = better results.

---

## Getting Help

If you're not sure how to phrase something or what to expect, just ask:
- "Can you help me with X?"
- "What's the best way to approach Y?"
- "I'm not sure what I need, but Z isn't working"

The orchestrator is here to help, not to require perfect inputs.
