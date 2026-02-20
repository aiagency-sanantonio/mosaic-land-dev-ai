

## Switch to Dropbox Refresh Token

This will permanently fix the token expiration problem so indexing can run for days without interruption.

### What you need to do first

You'll need to provide three credentials from your Dropbox App Console (https://www.dropbox.com/developers/apps):

1. **App Key** (also called Client ID) -- found on your app's settings page
2. **App Secret** (also called Client Secret) -- found on your app's settings page  
3. **Refresh Token** -- obtained by completing an OAuth flow with `token_access_type=offline`

If you're unsure how to get the refresh token, here's the quick process:
- Go to: `https://www.dropbox.com/oauth2/authorize?client_id=YOUR_APP_KEY&response_type=code&token_access_type=offline`
- Authorize the app, copy the authorization code
- Exchange it for a refresh token using a curl command (I'll provide the exact command once you share the App Key)

### What changes

**New secrets to add (3):**
- `DROPBOX_REFRESH_TOKEN`
- `DROPBOX_APP_KEY`
- `DROPBOX_APP_SECRET`

**Edge function update -- `batch-index/index.ts`:**

Instead of reading a static `DROPBOX_ACCESS_TOKEN`, the function will:

1. Read `DROPBOX_REFRESH_TOKEN`, `DROPBOX_APP_KEY`, and `DROPBOX_APP_SECRET` from secrets
2. Call the Dropbox OAuth token endpoint to exchange the refresh token for a fresh short-lived access token at the start of each batch
3. Use that fresh token for all Dropbox API calls in the batch
4. The old `DROPBOX_ACCESS_TOKEN` secret becomes unnecessary

**Frontend update -- `AdminIndexing.tsx`:**

Update the error handling to reference the refresh token instead of access token in error messages.

### Technical details

New helper function added to `batch-index/index.ts`:

```typescript
async function getDropboxAccessToken(): Promise<string> {
  const refreshToken = Deno.env.get('DROPBOX_REFRESH_TOKEN');
  const appKey = Deno.env.get('DROPBOX_APP_KEY');
  const appSecret = Deno.env.get('DROPBOX_APP_SECRET');

  if (!refreshToken || !appKey || !appSecret) {
    throw new Error('Dropbox OAuth not configured: need DROPBOX_REFRESH_TOKEN, DROPBOX_APP_KEY, DROPBOX_APP_SECRET');
  }

  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: appKey,
      client_secret: appSecret,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Dropbox token refresh failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.access_token;
}
```

The main handler replaces the static secret read with a call to this function. Each batch call (every ~15 seconds) gets a fresh token, so expiration is never a concern.

### After implementation

Once I add the code, I'll ask you to provide the three new secrets. Then we'll reset the token-expired failures again and resume indexing.

