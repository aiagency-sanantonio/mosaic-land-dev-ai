

## Add `retrieveStatus` function to `chat-rag`

### What it does

Queries `permits_tracking` for permit status data, with optional project and expiry filtering, and returns results with urgency classification.

### Implementation

Add `retrieveStatus(projectName: string | null, message: string)` after `retrieveAggregate`:

1. Creates Supabase client with service role key
2. Queries `permits_tracking`, filtering by `project_name` (ilike) if provided
3. Checks if `message` contains "expiring" or "due" — if so, filters to `expiration_date` within next 90 days using `.lte()` and `.gte()`
4. Orders by `expiration_date` ascending, limit 200
5. Maps each result to include:
   - `days_until_expiry`: calculated from `expiration_date - now`
   - `urgency`: `"EXPIRED"` (< 0), `"CRITICAL"` (≤ 30), `"WARNING"` (≤ 90), `"OK"` (> 90)
   - Plus: `project_name`, `permit_type`, `permit_no`, `status`, `description`, `issued_date`, `expiration_date`
6. Returns formatted JSON string

No database changes needed. Function defined but not yet wired into the main handler.

