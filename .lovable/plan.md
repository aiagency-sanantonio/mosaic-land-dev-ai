

## Extract dates from filenames when `date` is null

### What changes

**File: `supabase/functions/chat-rag/index.ts`**

1. **Add a `extractDateFromFilename` helper** (before `retrieveAggregate`) that tries two patterns on a filename:
   - `YYMMDD` — 6 digits at the start of the filename (e.g. `190128_BidTab.xlsx` → `2019-01-28`)
   - `YYYY-MM-DD` — anywhere in the filename (e.g. `report_2021-06-15.pdf` → `2021-06-15`)
   - Returns a `Date` object or `null`

2. **Update the null-date branch** in `retrieveAggregate` — instead of immediately flagging "No date available", call `extractDateFromFilename(r.source_file_name)`. If a date is found, use it for recency calculation and set the row's `date` field to a readable string like `"2019-01-28 (from filename)"`. If no date can be extracted, keep the existing flag.

### Helper function

```typescript
function extractDateFromFilename(fileName: string | null): Date | null {
  if (!fileName) return null;
  // Try YYYY-MM-DD anywhere
  const isoMatch = fileName.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const d = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`);
    if (!isNaN(d.getTime())) return d;
  }
  // Try YYMMDD at the start
  const yymmddMatch = fileName.match(/^(\d{2})(\d{2})(\d{2})/);
  if (yymmddMatch) {
    const yy = parseInt(yymmddMatch[1]);
    const year = yy >= 50 ? 1900 + yy : 2000 + yy;
    const d = new Date(`${year}-${yymmddMatch[2]}-${yymmddMatch[3]}`);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}
```

### Updated null-date branch (lines 117-118)

```typescript
if (!r.date) {
  const fileDate = extractDateFromFilename(r.source_file_name);
  if (fileDate) {
    // Use extracted date for recency check
    const ageMs = now.getTime() - fileDate.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const dateStr = fileDate.toISOString().split('T')[0];
    effectiveDate = `${dateStr} (from filename)`;
    if (ageDays > 730) {
      data_currency_flag = '⚠️ Data is over 2 years old — recommend getting fresh bids';
    } else if (ageDays > 365) {
      data_currency_flag = '⚠️ Data is 1-2 years old';
    }
  } else {
    data_currency_flag = '⚠️ No date available — cannot assess data currency';
  }
}
```

The row's `date` field in the output will use `effectiveDate` (either `r.date` or the extracted date string), so the synthesizer sees a meaningful date even when the DB field is null.

