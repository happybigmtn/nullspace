# Tool Reference

Quick reference for tools available to orchestrators and workers.

---

## Orchestrator Tools

These tools the orchestrator uses directly.

### Task (Spawn Workers)
```python
Task(
    subagent_type="...",     # Agent type
    description="...",        # Short description (3-5 words)
    prompt="...",            # Full task prompt
    model="haiku|sonnet|opus",  # Model selection
    run_in_background=True   # ALWAYS True
)
```

**Subagent Types:**
- `"general-purpose"` — For implementation, writing, editing
- `"Explore"` — For codebase exploration, searching
- `"Plan"` — For architectural planning

### Read (Coordination Only)
```python
Read(file_path="/absolute/path/to/file")
```

**Orchestrator reads:**
- Skill references (mandatory)
- Domain guides
- Quick index files (package.json, etc.)
- Agent output for synthesis

**Delegate to agents:**
- Multiple source files
- Deep codebase exploration
- Comprehensive analysis

### AskUserQuestion
```python
AskUserQuestion(questions=[
    {
        "question": "What's the scope?",
        "header": "Scope",          # Max 12 chars
        "options": [
            {"label": "Option A", "description": "Detailed description..."},
            {"label": "Option B", "description": "Detailed description..."},
            {"label": "Option C", "description": "Detailed description..."},
            {"label": "Option D", "description": "Detailed description..."}
        ],
        "multiSelect": False        # True for multiple selections
    }
])
```

**Limits:**
- 1-4 questions
- 2-4 options per question
- No limit on description length

### TodoWrite (Task Tracking)
```python
TodoWrite(todos=[
    {"content": "Task description", "status": "pending|in_progress|completed", "activeForm": "Doing task..."}
])
```

---

## Worker Tools

Workers use these execution tools directly.

### File Operations

**Read**
```python
Read(file_path="/path/to/file")
Read(file_path="/path/to/file", offset=100, limit=50)  # Lines 100-150
```

**Write**
```python
Write(file_path="/path/to/file", content="...")
```

**Edit**
```python
Edit(
    file_path="/path/to/file",
    old_string="text to replace",
    new_string="replacement text"
)
```

### Search

**Glob** (find files by pattern)
```python
Glob(pattern="**/*.ts")
Glob(pattern="src/**/*.rs", path="/specific/directory")
```

**Grep** (search file contents)
```python
Grep(pattern="function.*auth", glob="*.ts")
Grep(pattern="TODO", type="js", output_mode="content")
```

### System

**Bash** (shell commands)
```python
Bash(command="npm test", description="Run test suite")
Bash(command="cargo build", timeout=300000)
```

### Web

**WebFetch** (fetch and process URL)
```python
WebFetch(url="https://...", prompt="Extract the API documentation")
```

**WebSearch** (search the web)
```python
WebSearch(query="rust async best practices 2024")
```

---

## Model Selection Quick Reference

| Task Type | Model | Examples |
|-----------|-------|----------|
| Find/search | haiku | Grep patterns, glob files, list directories |
| Extract info | haiku | Read file and summarize, count occurrences |
| Implement (clear spec) | sonnet | Write function with defined behavior |
| Write tests | sonnet | Generate test cases for existing code |
| Follow patterns | sonnet | Create new file matching existing style |
| Design/architect | opus | Plan system structure, API design |
| Debug complex | opus | Trace issue across multiple systems |
| Security review | opus | Identify vulnerabilities, assess risk |
| Ambiguous tasks | opus | When you're not sure what to do |

---

## Worker Prompt Template

Always include this preamble when spawning workers:

```
CONTEXT: You are a WORKER agent, not an orchestrator.

RULES:
- Complete ONLY the task described below
- Use tools directly (Read, Write, Edit, Bash, etc.)
- Do NOT spawn sub-agents
- Do NOT call TaskCreate or TaskUpdate
- Report your results with absolute file paths

TASK:
[Your specific task here]
```

---

## Common Mistakes

### Wrong Tool Choice

| Trying to... | Wrong | Right |
|--------------|-------|-------|
| Find files | `Bash("find ...")` | `Glob(pattern="...")` |
| Search content | `Bash("grep ...")` | `Grep(pattern="...")` |
| Read file | `Bash("cat ...")` | `Read(file_path="...")` |
| Edit file | `Bash("sed ...")` | `Edit(file_path="...")` |

### Missing Parameters

```python
# ❌ Wrong: missing run_in_background
Task(subagent_type="general-purpose", prompt="...")

# ✅ Right: always background
Task(subagent_type="general-purpose", prompt="...", run_in_background=True)
```

### Orchestrator Executing

```python
# ❌ Wrong: orchestrator writing code
Write(file_path="...", content="...")

# ✅ Right: delegate to worker
Task(
    subagent_type="general-purpose",
    description="Create auth module",
    prompt="CONTEXT: You are a WORKER...\n\nTASK: Create /path/to/auth.ts...",
    model="sonnet",
    run_in_background=True
)
```
