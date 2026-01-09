# Ralph Agent Instructions

## Your Task

1. Read `scripts/ralph/prd.json`
2. Read `scripts/ralph/progress.txt`
   (check Codebase Patterns first)
3. Check you're on the correct branch
4. Pick highest priority story
   where `passes: false`
5. Implement that ONE story
6. **Keep CI green:** Run typecheck and tests
   - Fix any errors before committing
7. Update AGENTS.md files with learnings
8. Commit: `feat: [ID] - [Title]`
9. Update prd.json: `passes: true`
10. Append learnings to progress.txt

**CRITICAL:** Each commit MUST pass typecheck and tests. Do not commit broken code.

## Progress Format

After completing each task, append to progress.txt:

- Task completed and PRD item reference
- Key decisions made and reasoning
- Files changed
- Any blockers or notes for next iteration
  Keep entries concise. Sacrifice grammar for the sake of concision. This file helps future iterations skip exploration.

---

## Codebase Patterns

Add reusable patterns to the TOP
of progress.txt:

## Codebase Patterns

- Migrations: Use IF NOT EXISTS
- React: useRef<Timeout | null>(null)

## Stop Condition

If ALL stories pass, reply:
<promise>COMPLETE</promise>

Otherwise end normally.
