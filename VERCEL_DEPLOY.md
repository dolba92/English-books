# English Books — Vercel deployment

The repository is configured for deployment from the repository root.

Vercel should use:
- Framework: Vite
- Install command: `corepack enable && pnpm install --frozen-lockfile`
- Build command: `pnpm --filter @workspace/love-texas build`
- Output directory: `artifacts/love-texas/dist/public`

These values are also stored in `vercel.json`, so normally no manual overrides are required.

The SPA rewrite sends application routes back to `index.html`, so direct navigation/refresh on client-side routes works on Vercel.

`vite.config.ts` now defaults to port 5173 and base path `/` outside Replit, while still accepting Replit's `PORT` and `BASE_PATH` when they are present.
