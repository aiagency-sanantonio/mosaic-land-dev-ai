

## Add `retrieveAggregate` function to `chat-rag`

### What it does

A new async function that queries the `project_data` table for cost/metric data, prioritizes results by source quality, and returns formatted JSON.

### Implementation

**Add Supabase client import** at the top of the file.

**Add `retrieveAggregate(projectName: string | null)` function** that:

1. Creates a Supabase client with service role key
2. Queries `project_data`, filtering by `project_name` (ilike) if provided
3. Orders by `date` descending, limit 200
4. Sorts results in-memory by source priority:
   - **HIGH** — file path contains `zz md_50kft`, `recent bids`, or `bid tab`
   - **LOW** — file path contains `opc` or `opinion`
   - **NORMAL** — everything else
5. Returns a JSON string with each row mapped to: `project_name`, `category`, `metric_name`, `value`, `unit`, `date`, `source_file_name`, `source_priority` (labeled as `"HIGH (bid tab)"`, `"MED (compiled avg)"`, `"LOW (OPC)"`, or `"NORMAL"`)

No database changes needed. Function is not yet wired into the main handler — just defined for use in subsequent steps.

