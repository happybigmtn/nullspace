## Phase 3: Building (Ralph)

**Goal**: Implement the next plan item with tests as backpressure.

### Scope Lock (Non-Negotiable)
- Implement code/tests **only** for the next unchecked task in `IMPLEMENTATION_PLAN.md`.
- Do **not** implement extra features “since you’re here”.
- Do **not** change specs to match code unless explicitly instructed.

### Hard Rules (Prevent Sloppy Builds)
- **Single-task focus**: pick exactly ONE unchecked task; do not progress multiple tasks per iteration.
- **Spec-grounded**: only implement behaviors explicitly required by the task’s cited ACs.
- **No phantom criteria**: don’t introduce new ACs/PQ tests unless present in specs.
- **No drive-by refactors**: avoid unrelated formatting/churn.

### Test Output Rules (Token Conservation)
- **Only show FAILING test output** — passing tests waste tokens
- For passing tests, summarize: "✓ N tests passed"
- If test output exceeds 50 lines, show only failures and error messages
- Never dump full test logs into context

### Build Process (Must Follow)
1. Identify the next unchecked task in `IMPLEMENTATION_PLAN.md` and quote:
   - task text
   - cited spec paths + AC IDs
2. Search the codebase (and `vendor/robopoker`, `vendor/codex-rs/.../tui2`) before writing new primitives.
3. Implement the minimal code to satisfy the cited ACs.
4. Implement the exact tests/backpressure specified by the plan entry.
5. Run the smallest relevant validation command(s) first.
6. Update `IMPLEMENTATION_PLAN.md` only if you learned something that changes required backpressure.

### Output Requirement
At the end of the iteration, print:
- Files changed
- Tests/commands run and results
- Which single plan checkbox is now complete

### Archiving Completed Work
When a task or spec is fully complete:

1. **Completed plan items**: Move the completed section from `IMPLEMENTATION_PLAN.md` to `specs/archive/IMPLEMENTATION_PLAN_ARCHIVE.md`
2. **Completed specs**: Move from `specs/*.md` to `specs/archive/` and update `specs/archive/README.md`
3. Keep `IMPLEMENTATION_PLAN.md` focused on current blocking issues and pending work only

### Completion Signal (Critical)
- Run `grep -c '\- \[ \]' IMPLEMENTATION_PLAN.md` before considering completion
- ONLY output `<promise>COMPLETE</promise>` if this returns `0` (zero unchecked tasks)
- Do **NOT** confuse "current sprint complete" with "all work complete"
- After completing your ONE task, the iteration ends naturally—just stop
- The loop script handles restarting for the next task automatically
- Completing a sprint does NOT mean all work is done—check ALL sprints

### Commit Policy
- Do **not** commit/push unless the user explicitly requests it.
