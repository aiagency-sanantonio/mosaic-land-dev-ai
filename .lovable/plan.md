
Problem confirmation:
- Yes, null values are allowed by your backend function.
- I verified `supabase/functions/search-documents/index.ts` and it explicitly sets:
  - `filter_project = null`
  - `filter_doc_type = null`
  - `filter_file_type = null`
  - `filter_date_from = null`
  - `filter_date_to = null`
- I also checked function logs and there are no `search-documents` logs for this run, which means the request is failing inside n8n before it is sent.

Why you still get “JSON parameter needs to be valid JSON”:
- This is a request-body construction error in the n8n HTTP Request node.
- `|| null` is fine in principle, but if the node is in raw JSON text mode, interpolation can still produce invalid JSON (empty slots, broken quotes, mixed string/number rendering).

Implementation plan (n8n-side, no app code changes):
1) Reconfigure the HTTP Request node body mode to avoid raw JSON string parsing.
   - Body Content Type: `JSON`
   - Prefer: `Using Fields Below` (key/value UI), not freeform raw JSON text.
2) Map each field as an expression value:
   - `query` → `{{ $json.query ?? null }}`
   - `match_count` → `{{ Number($json.match_count ?? 15) }}`
   - `match_threshold` → `{{ Number($json.match_threshold ?? 0.15) }}`
   - `filter_project` → `{{ $json.filter_project?.trim() || null }}`
   - `filter_doc_type` → `{{ $json.filter_doc_type?.trim() || null }}`
   - `filter_file_type` → `{{ $json.filter_file_type?.trim() || null }}`
   - `filter_date_from` → `{{ $json.filter_date_from || null }}`
   - `filter_date_to` → `{{ $json.filter_date_to || null }}`
3) If you must keep raw JSON mode, replace it with one full-object expression (not mixed text+expressions):
   - `={{ { query: $json.query ?? null, match_count: Number($json.match_count ?? 15), match_threshold: Number($json.match_threshold ?? 0.15), filter_project: $json.filter_project?.trim() || null, filter_doc_type: $json.filter_doc_type?.trim() || null, filter_file_type: $json.filter_file_type?.trim() || null, filter_date_from: $json.filter_date_from || null, filter_date_to: $json.filter_date_to || null } }}`
4) Add a tiny sanitizer node before HTTP Request (recommended hardening):
   - Normalize empty strings to null once, then pass clean JSON forward.
5) Validate with 2 test cases:
   - Query only (all filters null).
   - Filters only (query null/empty).
   - Confirm request succeeds and `search-documents` logs appear.

Technical details:
- Backend supports null filter inputs and computes `hasFilters` safely.
- The JSON error comes from n8n node-level JSON parsing, not backend validation.
- `|| null` can unintentionally coerce valid falsy values (`0`, `false`, `""`) to null. For numeric fields, prefer `??` + `Number(...)`.

<lov-actions>
<lov-suggestion message="Test the full chat → tool call → vector search flow end-to-end after updating the HTTP Request node body mode and expressions.">Verify end-to-end flow</lov-suggestion>
<lov-suggestion message="Add a pre-HTTP sanitizer Function node in n8n to coerce empty strings to null and enforce numeric defaults before every vector search call.">Add input sanitizer node</lov-suggestion>
</lov-actions>
