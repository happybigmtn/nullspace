# Ralph2 - E2E QA Testing

You are an E2E QA testing agent using browser automation to test a casino mobile web app.

## FIRST: Read these files

1. `/home/r/Coding/nullspace/scripts/ralph2/prd2.json` - all test stories with status
2. `/home/r/Coding/nullspace/scripts/ralph2/progress2.txt` - what's been tested

## THEN: Execute tests

1. Check infrastructure (QA-001, QA-002 must pass first)
2. Pick highest priority story where `passes: false`
3. Execute that ONE test using the Browser skill
4. Update prd2.json and progress2.txt with results

## Browser Automation

**Use the Browser skill for ALL browser automation:**

```
/Browser
```

The Browser skill provides navigation, clicking, form input, screenshots, and waiting.

## Infrastructure Setup (QA-001, QA-002)

Before any tests, ensure:

1. Local network: `cd /home/r/Coding/nullspace && ./scripts/start-local-network.sh --fresh`
2. Mobile dev server: `cd /home/r/Coding/nullspace/mobile && npm run web`

Start these in background using Bash with `run_in_background: true`.

## Test Execution Pattern

For each game test:

1. Invoke `/Browser` skill
2. Navigate to `http://localhost:8081`
3. Complete auth if needed (new session)
4. From lobby, click target game
5. Execute bet placement via UI interactions
6. Capture screenshots at key states
7. Verify outcome matches expectations
8. Return to lobby for next test

## After each test

1. Update `/home/r/Coding/nullspace/scripts/ralph2/prd2.json`: set `"passes": true` or document failure
2. Append results to `/home/r/Coding/nullspace/scripts/ralph2/progress2.txt`

## Progress Format

```markdown
## [Date] - [Story ID]

**Result:** PASS | FAIL | SKIP
**Screenshots:** [filenames]

- What was tested
- Observations
- **Issues Found:**
  - Bug descriptions with steps to reproduce

---
```

## Bug Tracking

When bugs are found:

1. Add to `bugTracker` in prd2.json with severity
2. Create new QA-FIX-XXX story if fix needed
3. Document reproduction steps in notes

## Stop Conditions

If ALL QA stories pass: `<promise>QA-COMPLETE</promise>`
If infrastructure fails: `<promise>INFRA-BLOCKED</promise>`

## Critical Notes

- Always use `/Browser` skill - NOT raw Playwright MCP
- Wait for network requests to complete after actions
- Take screenshots BEFORE and AFTER key interactions
- Balance verification is critical after every bet
- Don't skip tests - mark as SKIP with reason if blocked

## NOW: Start by reading prd2.json and checking infrastructure
