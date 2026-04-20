# Future Cloudflare Migration

Status: keep this file untracked. Do not commit it until the migration approach is fully confirmed.

## Why this repo is a good early Cloudflare candidate

- The app is lean compared with the bakery repos.
- Realtime order updates already run in the browser, so the server is not carrying that burden.
- The main server-side work is Supabase reads, writes, and redirects.
- The current risk areas are small enough to fix before migration.

## Migration goal

Move `thesmokehouse-admin` to Cloudflare as a paid Workers/OpenNext deployment while keeping the app boring, predictable, and easy for staff to use.

## Main risks to handle first

1. Node-specific UUID generation in `lib/ops/actions.ts`.
2. Server actions that may quietly rely on Node assumptions.
3. Menu image uploads, because file workflows often expose runtime differences.
4. Environment-variable drift between Vercel and Cloudflare.

## Implementation plan

### Phase 1: Prepare the codebase

1. Replace Node-only UUID usage.
   - Open `lib/ops/actions.ts`.
   - Replace `randomUUID` imported from `node:crypto` with `crypto.randomUUID()`.
   - Run TypeScript after the change.

2. Centralize environment validation.
   - Create a small config helper if one does not already exist.
   - Validate required variables at startup:
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
     - `SUPABASE_SERVICE_ROLE_KEY`
   - Throw a clear error if any are missing.

3. Keep server actions thin.
   - Review `lib/ops/actions.ts`.
   - For each action, check that it only does:
     - input parsing
     - Supabase calls
     - redirects/revalidation
   - Avoid adding heavy formatting, file transformation, or hashing logic here.

4. Review image upload flow.
   - Find the menu image upload helper.
   - Confirm it only validates and uploads raw file data.
   - Do not add image processing during request handling.

### Phase 2: Add Cloudflare deployment scaffolding

1. Add the OpenNext Cloudflare adapter.
   - Install the adapter package recommended by current Cloudflare/OpenNext docs.
   - Add `wrangler` as a dev dependency.

2. Add Cloudflare config files.
   - Create `wrangler.jsonc` or `wrangler.toml`.
   - Add an OpenNext config file if required by the chosen adapter version.
   - Put comments in the file so a junior engineer knows what each binding is for.

3. Add package scripts.
   - Add scripts for local preview and Cloudflare build/deploy.
   - Keep the original `next dev` and `next build` scripts until the migration is proven.

4. Add environment documentation.
   - Create or update an env example file.
   - Add a small section that maps Vercel variables to Cloudflare secrets/vars.

### Phase 3: Validate runtime behavior

1. Test login.
   - Sign in through the admin login page.
   - Confirm Supabase cookie/session behavior works.

2. Test dashboard and orders.
   - Open dashboard.
   - Open orders list.
   - Confirm realtime still updates through the browser-side shared connection.

3. Test procurement and inventory flows.
   - Record a supplier receipt.
   - Record an inventory adjustment.
   - Confirm redirects and revalidation still refresh the correct pages.

4. Test menu image upload.
   - Upload a new image.
   - Confirm the file lands in storage and the URL is saved.

### Phase 4: Rollout plan

1. Deploy a preview environment on Cloudflare.
2. Compare core admin flows against the current Vercel deployment.
3. Keep Vercel available as rollback until at least one full staff workflow passes on Cloudflare.
4. Only switch DNS/production traffic after a calm day of internal testing.

## What to leave alone for now

- The browser-side realtime manager.
- Existing Supabase schema and RPC behavior.
- Existing page structure.

## Definition of done

- Admin login works.
- Dashboard loads.
- Orders page updates live.
- Procurement works.
- Menu image upload works.
- TypeScript passes.
- Rollback path is still available.
