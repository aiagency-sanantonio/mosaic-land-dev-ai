

## Fix N8N Agent Prompt: Add Discovery-First Search Pattern

### Problem
The agent guesses project names and filter values instead of discovering them first. The `filter_project` parameter requires **exact folder names** (e.g., "Landon Ridge"), but the agent often passes wrong or partial names, returning empty or irrelevant results.

### Solution
Add a small section to the prompt instructing the agent to **always call "List Available Filters" before searching**, and update the Vector Search tool instructions to reference those discovered values. Minimal changes to the existing prompt.

### Changes to the Prompt

**1. Add a new section after "## How to Answer Questions" / before "### 1. ALWAYS Search First":**

```
### 0. DISCOVER FILTERS FIRST
Before your first search in any conversation, call the "List Available Filters" tool. This returns:
- **projects**: Exact folder names (e.g., "Landon Ridge", "Mosaic")
- **doc_types**: Available document categories (e.g., "permit", "invoice", "contract")
- **file_types**: File extensions (e.g., "pdf", "xlsx")

You MUST use these exact values when setting filter_project, filter_doc_type, or filter_file_type in the search tool. Do NOT guess project names -- always match the user's request to the closest value from the discovered list.
```

**2. Update "### 2. Use Appropriate Search Parameters" to add filter guidance:**

Add after the existing bullet points:

```
- When filtering by project, use the EXACT folder name from the "List Available Filters" results (e.g., use "Landon Ridge" not "landon ridge" or "Landon")
- When the user asks about a document type (permits, contracts, etc.), set filter_doc_type to the matching value from the filter list
- You can combine a text query with filters for more precise results
```

**3. No other changes needed.** The rest of the prompt (structured tools, response format, examples, etc.) stays exactly as-is.

### Updated Prompt (only the changed sections shown)

Section to insert before "### 1. ALWAYS Search First":

```text
### 0. DISCOVER FILTERS FIRST
Before your first search in any conversation, call the "List Available Filters" 
tool. This returns the exact values you must use for search filters:
- **projects**: Exact folder names (e.g., "Landon Ridge", "Mosaic")
- **doc_types**: Document categories (e.g., "permit", "invoice", "contract")
- **file_types**: File extensions (e.g., "pdf", "xlsx")

NEVER guess or fabricate filter values. Always match the user's request to the 
closest value from this list. If no match exists, omit that filter.
```

Updated "### 2. Use Appropriate Search Parameters":

```text
### 2. Use Appropriate Search Parameters
- For broad questions (aggregations, comparisons): use match_count: 20, match_threshold: 0.15
- For specific lookups: use match_count: 10, match_threshold: 0.2
- When the user mentions a specific project, set filter_project to the EXACT 
  folder name from the "List Available Filters" results
- When the user asks about a document type, set filter_doc_type to the matching 
  value from the filter list
- You can combine a text query with filters for more precise results
```

### Summary
Two small insertions to the existing prompt. Everything else stays the same. This ensures the agent always has the correct filter vocabulary before searching.

