

## Fix N8N Agent Prompt: Structured + Vector Search Routing

### Problem
The prompt has three gaps that cause the agent to misroute queries or return empty results:
1. Filter discovery (Step 0) only covers vector search, but structured tools use different matching
2. "ALWAYS Search First" (Step 1) biases the agent toward vector search even for data questions
3. No fallback logic when one tool type returns empty results

### Changes (3 small edits to existing sections)

#### 1. Update Step 0 — clarify scope of discovered filters

Current ending:
```
NEVER guess or fabricate filter values. Always match the user's request to the 
closest value from this list. If no match exists, omit that filter.
```

Replace with:
```
NEVER guess or fabricate filter values. Always match the user's request to the 
closest value from this list. If no match exists, omit that filter.

NOTE: These discovered values apply to the **Vector Search** tool's filter_project, 
filter_doc_type, and filter_file_type parameters. The Structured Query Tools 
(Project Metrics, Permits, DD Status, Compare Projects) use fuzzy project_name 
matching, so partial names like "Mosaic" or "Hillside" work there without exact 
folder names.
```

#### 2. Rewrite Step 1 — add tool selection logic before "search first"

Current:
```
### 1. ALWAYS Search First

For any question about projects, costs, permits, dates, or specific documents, 
use the search tool. Never guess or make up information.
```

Replace with:
```
### 1. CHOOSE THE RIGHT TOOL, THEN SEARCH

Never guess or make up information. Always query your tools first.

**Use Structured Query Tools** for questions about:
- Costs, pricing, lot counts, acreage → Query Project Metrics
- Permit status, expiration dates, bonds → Query Permits
- Due diligence checklist progress → Query DD Status
- Side-by-side project comparisons → Compare Projects

**Use Vector Search** for questions about:
- Document content ("What does the contract say about...")
- Finding specific files ("Find the drainage report for...")
- Discovering information you don't know exists
- General questions that don't fit a structured category

If one tool returns no results, try the other as a fallback.
```

#### 3. No other changes

Steps 2-6, Response Format, Examples, Structured Data Tools section, and Decision Logic all stay exactly as-is. The decision logic at the bottom reinforces the routing added in Step 1.

### Summary

Three small text edits:
- Step 0: Add a note that discovered filters are for vector search; structured tools use fuzzy matching
- Step 1: Replace "ALWAYS Search First" with tool selection guidance + fallback instruction
- Everything else unchanged
