

# Analysis: Can the Current System Answer These Questions?

## Honest Assessment: Most of These Will Fail

After examining your 291,655 document chunks across 9,530 files, I identified several fundamental gaps. Here's a question-by-question breakdown followed by a concrete improvement plan.

---

## Question-by-Question Analysis

| Question | Can Answer? | Why / Why Not |
|----------|------------|---------------|
| Average cost of excavation ($4/acre) | **No** | Costs are captured as raw numbers with no category (excavation vs. engineering vs. land). The regex grabs every `$X` it finds. |
| Hard cost difference over 3 years ($2k/lot) | **No** | No temporal cost tracking. Dates extracted are unreliable strings, not parsed values. No way to compare across time periods. |
| Average DD engineering cost per lot ($500) | **No** | No cost categorization and no lot count data linked to costs. |
| Lots available across projects (5,000) | **Partial** | Can find land plan documents, but lot counts aren't extracted as structured data. The AI would need to read and count from text -- unreliable. |
| Average price per acre for land ($30k) | **No** | Acreage and price aren't linked as structured pairs. The system captures all dollar amounts but doesn't know which ones are land prices. |
| Permits/bonds about to expire | **Broken** | The expiration regex is far too greedy -- it's capturing noise like `"of the Feasibility Period"` instead of actual dates. Permit regex captures words like `"s"`, `"the"`, `"ted"` instead of permit numbers. |
| DD checklist items not done for "Tract" | **Partial** | Can find DD documents for a tract, but has no checklist tracking to know what's done vs. not done. |
| Compare Clearwater to Garza & Baraka | **Partial** | Can retrieve docs for each project via folder path filtering, but can't aggregate or compare structured metrics. Limited to 15-20 chunks per search. |
| Outstanding escrow accounts | **Partial** | Can find escrow-related documents but can't determine "outstanding" status from unstructured text. |
| Bexar County project timeline (200 acres) | **Partial** | Can find Bexar County deals but can't extract and compare timelines across projects systematically. |

**Score: 0 fully reliable, 5 partial, 5 broken/impossible**

---

## Root Causes

### 1. Metadata Extraction is Too Noisy
The regex patterns are capturing garbage data:
- **Permits**: Extracting `["s", "the", "ted", "Seller"]` instead of actual permit numbers
- **Expirations**: Capturing `"of the Feasibility Period"` instead of dates
- **Costs**: Capturing every dollar amount with no context about what the cost is for

### 2. No Structured/Tabular Data Layer
The system treats everything as flat text chunks. Questions like "average cost of excavation" require structured data: `{project, cost_category, amount, date, acreage, lot_count}`.

### 3. Limited Aggregation Capability
Vector search returns 15-20 best-matching chunks. Questions requiring aggregation across hundreds of documents (averages, totals, comparisons) can't work with a handful of chunks.

### 4. No Temporal Intelligence
Dates are stored as raw strings, not parsed timestamps. Can't query "costs from 3 years ago" or "permits expiring in the next 90 days."

---

## Proposed Solution: Structured Data Extraction Layer

### Phase 1: New `project_data` Table (Structured Metrics)
Create a structured table that stores extracted business metrics:

```text
project_data table:
+------------------+------------+------------------+---------+--------+-----------+
| project_name     | category   | metric_name      | value   | unit   | date      |
+------------------+------------+------------------+---------+--------+-----------+
| Clearwater Creek | excavation | cost_per_acre    | 4.00    | $/acre | 2025-01   |
| Clearwater Creek | land       | price_per_acre   | 30000   | $/acre | 2024-06   |
| Clearwater Creek | lots       | total_count      | 350     | lots   | 2025-01   |
| Garza & Baraka   | dd_eng     | cost_per_lot     | 500     | $/lot  | 2025-03   |
+------------------+------------+------------------+---------+--------+-----------+
```

### Phase 2: New `permits_tracking` Table
```text
permits_tracking table:
+------------------+------------------+-------------+-------------+-----------+
| project_name     | permit_type      | permit_no   | issued_date | exp_date  |
+------------------+------------------+-------------+-------------+-----------+
| Clearwater Creek | TPDES Permit     | TXR150000   | 2024-01-15  | 2025-07-15|
| Garza & Baraka   | Plat Bond        | BD-2024-001 | 2024-03-01  | 2025-03-01|
+------------------+------------------+-------------+-------------+-----------+
```

### Phase 3: New `dd_checklists` Table
```text
dd_checklists table:
+------------------+------------------------+----------+----------------+
| project_name     | checklist_item         | status   | completed_date |
+------------------+------------------------+----------+----------------+
| Dean Tract       | Phase I Environmental  | done     | 2024-11-15     |
| Dean Tract       | ALTA Survey            | pending  | null           |
| Dean Tract       | Geotech Report         | done     | 2024-12-01     |
+------------------+------------------------+----------+----------------+
```

### Phase 4: AI-Powered Extraction During Indexing
Update the `process-document` function to use an LLM (instead of just regex) to extract structured data during indexing. For each document, the LLM would identify:
- Cost line items with categories and units
- Permit/bond numbers with actual issue/expiration dates
- Lot counts and acreage figures
- Project milestones and timeline events

### Phase 5: New Search Tools for N8N Agent
Add dedicated backend functions the AI agent can call:
- `query-project-metrics`: SQL-based aggregation (averages, sums, comparisons across projects)
- `query-permits-expiring`: Returns permits/bonds expiring within N days
- `query-dd-status`: Returns checklist status for a given tract/project
- `compare-projects`: Side-by-side metrics for two or more projects

The existing vector search would remain for open-ended questions, but these structured tools handle the analytical/aggregation questions reliably.

---

## What This Enables

| Question | How It Would Work |
|----------|-------------------|
| Avg excavation cost | `SELECT AVG(value) FROM project_data WHERE category='excavation'` |
| Hard cost change over 3 yrs | `SELECT year, AVG(value) FROM project_data WHERE category='hard_costs' GROUP BY year` |
| DD eng cost per lot | `SELECT AVG(value) FROM project_data WHERE metric_name='dd_engineering_per_lot'` |
| Available lots | `SELECT project_name, SUM(value) FROM project_data WHERE metric_name='lot_count'` |
| Expiring permits | `SELECT * FROM permits_tracking WHERE exp_date < NOW() + interval '90 days'` |
| DD items not done | `SELECT * FROM dd_checklists WHERE project='Tract X' AND status='pending'` |
| Compare projects | Two queries against `project_data` for each project, side-by-side |

---

## Implementation Priority

1. **Quick win (fix regex)**: Tighten the permit/expiration patterns so they stop capturing garbage -- this improves current search quality immediately
2. **Create structured tables**: `project_data`, `permits_tracking`, `dd_checklists`
3. **Add LLM extraction to indexing pipeline**: Use AI to populate structured tables during document processing
4. **Add new query tools for N8N**: Give the agent SQL-backed tools for aggregation questions
5. **Re-index existing documents**: Run structured extraction on existing 9,530 files

This is a significant but high-value architectural change. The vector search stays for open-ended questions, but analytical/aggregation questions get routed to structured SQL queries instead.

