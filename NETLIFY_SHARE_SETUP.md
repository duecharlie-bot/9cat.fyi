# nineCat short share links — Netlify setup

This build creates persistent share links such as:

`https://9cat.fyi/s/3d6b8504`

## What was added

- `package.json` — installs `@netlify/blobs`.
- `netlify/functions/share.mjs` — creates and retrieves draft shares.
- `_redirects` — rewrites `/s/<id>` to the existing share page.
- `js/share.js` — `Copy share` requests a short link first and falls back to the old self-contained link if the API is unavailable.
- `s/share-view.js` — loads either a short stored share or an old `?d=` share.

## Deploy

1. Commit these files to the same Git branch Netlify deploys.
2. Push the branch.
3. In the Netlify deploy log, confirm the `share` function is detected/bundled and the rate-limit rule is accepted.
4. Open the deploy preview, finish a draft, and click **Copy share**.
5. Paste the copied link into a new/incognito window. It should look like `/s/xxxxxxxx` and load the saved draft.

No Netlify environment variables or separate database account are required when `@netlify/blobs` runs inside a Netlify Function.

## Fallback behavior

If `/api/share` cannot create a short link, nineCat automatically copies the existing self-contained `/s/?d=...` link instead, so sharing does not break.
