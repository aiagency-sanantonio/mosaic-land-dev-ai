
The user wants to understand the remaining ~31k files before we run the indexing optimization. Let me query the database to get real stats on:
1. How many remaining files are inside vs outside ARCHIVE folders
2. File size distribution of the unindexed files
3. Extension breakdown

I'll use read-only tools (supabase--read_query) to gather this data, then present findings + the optimization plan together.
