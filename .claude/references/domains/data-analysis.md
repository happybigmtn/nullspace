# Data Analysis Domain Guide

## When This Applies
- Data exploration
- Statistical analysis
- Report generation
- Data transformation
- Query optimization
- Data quality assessment

---

## Task Decomposition Patterns

### Data Exploration
```
┌─────────────────────────────────────────────────────────────┐
│  PARALLEL INVESTIGATION                                     │
│                                                             │
│  Agent 1: Schema Understanding                              │
│     • Table structures                                     │
│     • Column types                                         │
│     • Relationships                                        │
│                                                             │
│  Agent 2: Data Profile                                      │
│     • Row counts                                           │
│     • Value distributions                                  │
│     • Null rates                                           │
│                                                             │
│  Agent 3: Data Quality                                      │
│     • Anomalies                                            │
│     • Inconsistencies                                      │
│     • Missing data patterns                                │
│                                                             │
│  Agent 4: Sample Analysis                                   │
│     • Representative records                               │
│     • Edge cases                                           │
│     • Common patterns                                      │
│                                                             │
│  SYNTHESIZE → Data understanding document                  │
└─────────────────────────────────────────────────────────────┘
```

### Report Generation
```
┌─────────────────────────────────────────────────────────────┐
│  1. UNDERSTAND                                              │
│     • What question are we answering?                      │
│     • Who is the audience?                                 │
│     • What data is available?                              │
│                                                             │
│  2. QUERY (parallel by data source)                        │
│     • Extract relevant data                                │
│     • Join/aggregate as needed                             │
│     • Validate results                                     │
│                                                             │
│  3. ANALYZE                                                 │
│     • Statistical summaries                                │
│     • Trends and patterns                                  │
│     • Anomalies and outliers                               │
│                                                             │
│  4. PRESENT                                                 │
│     • Clear visualizations                                 │
│     • Key insights highlighted                             │
│     • Caveats and limitations noted                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Agent Allocation

| Analysis Task | Model | Why |
|---------------|-------|-----|
| Count rows/columns | haiku | Simple query |
| List table schemas | haiku | Extraction |
| Write data query | sonnet | Structured task |
| Statistical summary | sonnet | Clear methodology |
| Interpret findings | opus | Judgment required |
| Design analysis approach | opus | Problem solving |

---

## Quality Checklist

Good data analysis:
- [ ] Question clearly stated
- [ ] Data sources documented
- [ ] Methodology explained
- [ ] Assumptions listed
- [ ] Limitations acknowledged
- [ ] Results reproducible
- [ ] Visualizations clear

---

## Common Analysis Patterns

### Descriptive Statistics
```
- Count, distinct count
- Min, max, mean, median
- Standard deviation
- Percentiles (25th, 50th, 75th, 95th, 99th)
- Null rate
```

### Time Series
```
- Trend (up, down, stable)
- Seasonality (daily, weekly, monthly)
- Anomalies (spikes, drops)
- Moving averages
- Year-over-year comparison
```

### Comparison
```
- Before/after
- A vs B (groups)
- Expected vs actual
- Benchmark vs performance
```

---

## Data Quality Checks

### Always Verify
1. **Completeness** — Are there missing values?
2. **Accuracy** — Do values make sense?
3. **Consistency** — Same thing represented same way?
4. **Timeliness** — Is data current enough?
5. **Uniqueness** — Unexpected duplicates?

### Red Flags
- Sudden changes in volume
- Values outside expected ranges
- Impossible combinations
- Truncated or rounded data
- Timezone mismatches

---

## Common Pitfalls

1. **Answering wrong question** — Clarify before analyzing
2. **Survivorship bias** — Consider what's NOT in the data
3. **Correlation vs causation** — Be careful with conclusions
4. **Sample size issues** — Small n = unreliable results
5. **Cherry-picking** — Show the full picture
6. **Not validating** — Sanity check results against known truths
