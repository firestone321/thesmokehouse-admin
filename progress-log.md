# Smokehouse Database Progress Log

## Purpose

This log records the database design work completed so far for the Smokehouse admin system.
It is intended to make future audits, schema reviews, and migration planning easier.

Core working assumptions:

- Database: Supabase Postgres
- Inventory is tracked at the sellable portion level
- Admin's main operational question is: how much stock is left today?
- Design should stay close to practical kitchen workflow, not telemetry-heavy smoker modeling

## Repo Locations

Current local repo locations used for this project:

- Admin dashboard repo: `C:\Users\Jurugo\OneDrive\VS Code\Web Development\thesmokehouse-admin`
- Client storefront repo: `C:\Users\Jurugo\OneDrive\VS Code\Web Development\thesmokehouse`

## Phase 1: Reference Tables And Menu Modeling

Status: drafted in SQL

File:

- `db/phase-01-reference-tables.sql`

What was added:

- `public.proteins`
- `public.packaging_types`
- `public.portion_types`

Why this phase exists:

- Establish the real smokehouse menu in database form before stock or orders are modeled
- Make `portion_types` the stockable and sellable unit for later phases

Menu modeled in Phase 1:

- Beef ribs, `300g`
- Beef chunks, `300g`
- Chicken half
- Chicken quarter
- Goat ribs, `350g`
- Goat chunks, `350g`
- Juice

Seed/reference assumptions captured:

- Most meat uses `clamcraft_box`
- Beef chunks use `butcher_paper`
- `juice` is temporarily represented in `portion_types` with nullable `protein_id`

What was intentionally deferred:

- Prices
- Orders
- Daily stock
- Stock reservations
- Stock movements
- Pit workflow tables
- Raw meat deliveries and yield accounting

## Phase 2: Daily Stock

Status: drafted in SQL, audited, refined with audit patch

File:

- `db/phase-02-daily-stock.sql`

What was added:

- `public.daily_stock`
- `public.set_updated_at()` trigger function
- `daily_stock_set_updated_at` trigger

Current Phase 2 purpose:

- Store one stock row per `portion_type` per service day
- Record morning prep `starting_quantity`
- Track `reserved_quantity`, `sold_quantity`, and `waste_quantity`

Current daily stock rule:

- Remaining stock is effectively:
  `starting_quantity - reserved_quantity - sold_quantity - waste_quantity`

Current schema decisions:

- Composite primary key on `(stock_date, portion_type_id)`
- Non-negative quantity checks
- `remaining_quantity` is a generated stored column
- Accounting check prevents `remaining_quantity` from going below zero
- History index on `(portion_type_id, stock_date desc)`
- Automatic `updated_at` trigger
- Dashboard helper function `public.get_daily_menu_stock(date)`
- Row-level security enabled on `daily_stock`
- Direct `insert`, `update`, and `delete` revoked from `anon` and `authenticated`

Operational behavior intended for later application logic:

- Unpaid order does not reserve stock
- Payment-confirmed order reserves stock
- Completed order moves reserved stock to sold
- Cancelled/refunded order releases reserved stock appropriately

## Phase 2 Audit Summary

Status: reviewed in detail

What the audit confirmed as correct:

- The table grain is correct for smokehouse workflow
- The composite primary key on `(stock_date, portion_type_id)` is correct
- Integer counters are appropriate because stock is tracked as discrete portions
- The accounting constraint is the correct core anti-oversell invariant
- The conditional reservation update pattern is safe for a single row in Postgres

Audit fixes now implemented:

- Removed example `daily_stock` operational seed rows from the migration
- Removed the redundant index on `stock_date`
- Added `remaining_quantity` as a generated stored column
- Added `public.get_daily_menu_stock(date)` for dashboard reads
- Enabled row-level security on `daily_stock`
- Revoked direct mutation privileges from `anon` and `authenticated`

Recommended follow-up still open:

- Treat service day carefully so app and database agree on the Uganda service date
- Reserve multi-item orders in one transaction and in deterministic row order

Important limitation still acknowledged:

- Phase 2 does not yet prove that `sold_quantity` came from prior reservations
- Phase 2 does not yet provide full auditability of stock changes
- Those concerns are intentionally deferred to later phases, especially `orders` and `stock_movements`

## Pending Follow-Up

These items are known next steps, not completed work:

- Design Phase 3 around `orders` and `order_items`
- Design stock reservation flow tied to order lifecycle
- Add auditable `stock_movements`

## Pending Change: Order Lifecycle Simplification

Status: pending design and implementation

Why this change is pending:

- The current dashboard order flow still relies on too many manual human-driven status updates
- This creates unnecessary staff effort during busy service and increases the chance that the system feels burdensome instead of helpful
- The intended direction is to reduce required admin actions to only the points where staff are actually doing operational work

Proposed future direction:

- Replace the heavier manual progression with a simpler flow centered on:
  `paid` -> `preparing` -> `ready` -> `completed`
- Keep `cancelled` as the terminal exception path
- Once Pesapal is integrated, successful payment should create or move the order into `paid` automatically instead of depending on a manual confirmation step
- Staff should manually move the order from `paid` to `preparing`
- Staff should manually move the order from `preparing` to `ready`
- Customer handoff should use OTP or pickup-code verification
- If the presented OTP matches, the system should complete the handoff and auto-transition the order to `completed`

Important design implication:

- The current status chain:
  `new` -> `confirmed` -> `in_prep` -> `on_smoker` -> `ready` -> `completed`
  is now considered too manual for the intended day-to-day workflow
- Operational sub-stages such as smoker activity may still matter internally, but they should not force extra dashboard clicks unless there is a strong real-world need

Reason for deferring this change for now:

- Pesapal payment integration is not yet in place
- OTP-based customer pickup verification is not yet implemented
- The admin and storefront flow should be updated together so payment, readiness, pickup verification, and auto-completion remain consistent across both apps

## Phase 19: Order Lifecycle Simplification

Status: implemented locally in the admin repo and ready for schema rollout

Why this phase was needed:

- The live order flow still asked staff to click through an extra `on_smoker` stage that does not add enough value for day-to-day service
- The handoff step needed to match the intended customer experience where the customer shows a pickup code before the order is marked completed
- The workflow needed to stay simple enough for staff to move quickly without extra operational friction

What Phase 19 introduces:

- A simplified order lifecycle:
  `new` -> `confirmed` -> `in_prep` -> `ready` -> `completed`
- Removal of the manual `on_smoker` order status from both schema constraints and admin UI flow
- A pickup-code-gated completion action on the admin order detail page
- Completion behavior where staff enter the 4-digit code shown in the customer's app and a correct match auto-completes the order

Schema and migration updates:

- Added `db/phase-19-order-lifecycle-simplification.sql`
- Updated `db/phase-03-operations-core.sql`
- Updated `db/merged-live-schema.sql`

What the live migration does:

- Remaps any existing `orders.status = 'on_smoker'` rows to `in_prep`
- Remaps legacy `order_status_events.from_status` and `to_status` values from `on_smoker` to `in_prep`
- Rebuilds the order status constraints without `on_smoker`
- Replaces `public.transition_order_status(...)` so the valid forward path is now:
  `new -> confirmed -> in_prep -> ready -> completed`

App updates tied to Phase 19:

- Updated `lib/ops/types.ts`
- Updated `lib/ops/queries.ts`
- Updated `lib/ops/actions.ts`
- Updated `app/(admin)/orders/page.tsx`
- Updated `app/(admin)/orders/[orderId]/page.tsx`
- Updated `app/(admin)/dashboard/page.tsx`

Important current behavior:

- Staff now move orders from `Confirmed` straight to `In prep`
- Staff now move orders from `In prep` straight to `Ready`
- Orders can no longer be completed from the generic status button path
- Ready orders must be completed through pickup-code verification on the order detail page

Verification pending:

- Run `npx.cmd tsc --noEmit`
- Run `npm.cmd run build`

## Phase 3: Live Operations Slice

Status: implemented in repo, migration drafted, build blocked by local `.next` file lock

Files added:

- `db/phase-03-operations-core.sql`
- `lib/supabase/server.ts`
- `lib/admin/nav.ts`
- `lib/ops/types.ts`
- `lib/ops/utils.ts`
- `lib/ops/queries.ts`
- `lib/ops/actions.ts`
- `app/(admin)/orders/[orderId]/page.tsx`

Files updated:

- `app/(admin)/dashboard/page.tsx`
- `app/(admin)/inventory/page.tsx`
- `app/(admin)/menu/page.tsx`
- `app/(admin)/orders/page.tsx`
- `components/dashboard/admin-sidebar.tsx`
- `package.json`

What Phase 3 introduced:

- Real Supabase server-side client setup
- Live menu categories, menu items, and menu item components schema
- Live inventory items and inventory movement schema
- Live orders, order items, and order status event schema
- Optional `ops_incidents` table for dashboard issues
- Server-side operational queries and server actions
- Orders list and order detail route backed by live data
- Inventory page backed by live `daily_stock`, `inventory_items`, and `inventory_movements`
- Menu page backed by live categories, items, toggles, and component links
- Dashboard rewritten as a read model over live orders, inventory, and incidents

Important implementation decisions:

- The dashboard is no longer its own source of truth
- Sidebar fake counters were removed
- Staff remains deferred
- Settings remains in place without expansion
- Kitchen Queue remains scaffolded for a later phase

Verification completed:

- `npx tsc --noEmit` passes

Verification still blocked locally:

- `npm run build` compiles the app and reaches the build step, but fails because a locked `.next` path inside OneDrive cannot be unlinked on this machine right now

## Notes For Future Audits

When reviewing future phases, verify these invariants first:

- Stock is always tracked against `portion_types`
- One `daily_stock` row exists per `portion_type` per service day
- Oversell prevention remains enforced at the database write path, not only in UI logic
- Status concepts stay separated:
  order status, stock state, kitchen workflow stage

## Go-Live Bootstrap Files

Status: implemented in repo and pushed to `main`

Files added:

- `db/phase-04-go-live-bootstrap.sql`
- `db/phase-05-packaging-inventory-bootstrap.sql`
- `db/phase-06-menu-prices-and-activation.sql`
- `db/phase-07-inventory-opening-balances.sql`
- `db/phase-08-ops-incidents-bootstrap.sql`

What these files are for:

- Phase 4 creates the first `menu_items` rows from the existing `portion_types`
- Phase 5 creates packaging-focused `inventory_items` and links them to menu items through `menu_item_components`
- Phase 6 is a safe template for real menu prices, `is_active`, and `is_available_today`
- Phase 7 is a safe template for real opening balances and reorder thresholds using `apply_inventory_adjustment`
- Phase 8 is a safe template for logging real open incidents into `ops_incidents`

Important design decision:

- These files avoid inserting fake orders, fake stock history, or guessed kitchen consumption
- Template phases are intentionally no-op until real values are inserted into their CTE input blocks

Operational follow-up still required:

- Enter real prices
- Enter real opening balances and reorder thresholds
- Decide which menu items are actually active and available today
- Add only real incidents, if any exist at go-live

Commit reference:

- Git commit `1dd71f0` includes the go-live bootstrap SQL phases

## Phase 9: Menu Item Images

Status: implemented in repo, pushed to `main`, and applied in Supabase

Files added:

- `db/phase-09-menu-item-images.sql`

Files updated:

- `db/merged-live-schema.sql`
- `lib/ops/errors.ts`
- `lib/ops/types.ts`
- `lib/ops/queries.ts`
- `lib/ops/actions.ts`
- `app/(admin)/menu/page.tsx`

What Phase 9 introduced:

- `menu_items.image_url`
- Supabase storage bucket `menu-item-images`
- Menu item image upload from the admin edit form
- Public image preview on the menu page

Image upload rules currently implemented:

- Allowed file types: JPG, PNG, WebP
- Maximum file size: 5MB
- New upload replaces the existing image for that menu item

Verification completed:

- `npx tsc --noEmit` passes after the image upload changes

Required follow-up:

- Verify end-to-end image upload behavior in the live app after Supabase storage setup

## Menu Admin UX Refinements

Status: implemented in repo and pushed to `main`

What was fixed:

- Portion types already linked to another menu item are now disabled in the menu form
- Duplicate `portion_type_id` submissions now redirect back with a human-readable error instead of exposing the raw database constraint message
- Menu item code entry was removed from the form
- Menu category code entry was removed from the form
- Codes are now generated automatically from the typed name using the existing `toCode()` logic
- Menu image upload field was moved near the bottom of the form, just above the `Active` and `Available today` checkboxes
- The visible menu item `sort_order` number input was removed from the form because it was confusing for normal admin use
- Base price input is now explicitly labeled
- The `prep_type` dropdown label was refined to the staff-facing label: `Preparation type`
- The visible `prep_type` options are now `Roasted`, `Kitchen`, and `Drink`
- Menu save now shows live step-by-step progress during create, update, image upload, and final refresh
- The edit panel now remounts correctly when switching selected menu items, so full item details load into the edit form
- The stuck `Finishing up` state was fixed for same-item edits
- Next.js server action body limit was raised to `8mb` to support image uploads while app-side validation still limits files to `5MB`

Important current behavior:

- New menu item codes are generated from the entered display name
- Existing menu item codes are preserved during edit
- Menu category codes are generated from the entered category name
- Menu item `sort_order` is still preserved and submitted as a hidden field

Reason for the duplicate portion-type guardrail:

- The schema keeps `menu_items.portion_type_id` unique
- This enforces the current design rule of one menu item per stockable `portion_type`

Commit reference:

- Git commit `1dd71f0` includes the go-live bootstrap SQL phases and menu admin guardrails
- Git commit `d538d0b` refines the menu preparation label wording
- Git commit `76c6697` adds live save-step feedback, the menu form client component, edit-panel reload fixes, and the server action body size limit increase

## Authentication Rollout

Status: implemented in repo and pushed to `main`

Files added:

- `app/login/page.tsx`
- `app/auth/callback/route.ts`
- `components/auth/logout-button.tsx`
- `lib/auth/actions.ts`
- `lib/auth/utils.ts`
- `lib/supabase/shared.ts`
- `proxy.ts`

Files updated:

- `app/(admin)/layout.tsx`
- `components/dashboard/admin-sidebar.tsx`
- `components/dashboard/dashboard-shell.tsx`
- `lib/supabase/server.ts`
- `package.json`
- `package-lock.json`

What was added:

- Passwordless magic-link login flow
- Session-based protection around admin routes
- Auth callback route for Supabase email link exchange
- Sign out action in the admin shell
- Existing-user-only sign-in behavior using `shouldCreateUser: false`

Important auth rules now in place:

- No password flow was added
- Magic links should only work for emails already saved in Supabase Auth
- Unknown emails should not create new users

Framework follow-up completed:

- Next.js auth gate entrypoint was migrated from `middleware.ts` to `proxy.ts` to match the current framework convention

Commit reference:

- Git commit `c3cee8d` adds magic-link auth for existing users
- Git commit `ee9bdc1` switches the auth gate from `middleware` to `proxy`

## Phase 10: Storefront Shared Order Support

Status: implemented in repo, pushed to `main`, storefront code aligned, and applied in Supabase

Files added:

- `db/phase-10-storefront-shared-order-support.sql`

Files updated:

- `db/merged-live-schema.sql`

What Phase 10 introduces:

- Shared database-generated `order_number` values starting from `1000`
- `public.orders.public_token` for customer-facing order tracking
- `public.orders.pickup_code` for customer pickup handoff
- A unique partial index on `public_token`
- A format constraint enforcing 4-digit `pickup_code` values

Why this phase was needed:

- The storefront and admin dashboard now need to use the same `orders` table instead of parallel schemas
- The existing admin operations schema did not yet include the storefront's public tracking fields
- This keeps ordering, tracking, and back-of-house management in one operational record

Current run order note:

- If Phases 1 through 9 are already applied, only `db/phase-10-storefront-shared-order-support.sql` needs to be run next
- The merged schema file was updated so fresh installs include Phase 10 automatically

Commit reference:

- Git commit `e808185` adds the shared storefront order schema support

## Storefront Supabase Migration And Cleanup

Status: implemented in storefront repo, pushed to `main`, and verified with TypeScript and production build

Storefront repo:

- `C:\Users\Jurugo\OneDrive\VS Code\Web Development\thesmokehouse`

What was changed in the storefront repo:

- Removed fallback/mock menu and order behavior so customer flows now read and write through Supabase
- Added `lib/shared-schema.ts` to map the shared admin schema into storefront-facing menu and order shapes
- Updated storefront menu loading to read live `menu_items` using `base_price`, `prep_type`, `is_active`, `is_available_today`, and `menu_categories`
- Updated storefront order creation to write into shared `orders` and `order_items`
- Updated storefront order tracking to read from shared `orders` and `order_items`
- Removed `lib/mock-db.ts`
- Sanitized persisted cart IDs so stale mock UUID cart data does not poison the live numeric menu item flow
- Removed the embedded storefront admin surface:
  `app/admin/page.tsx`,
  `components/admin-dashboard.tsx`,
  `app/api/admin/orders/route.ts`,
  `app/api/admin/orders/[id]/route.ts`
- Added the Supabase Storage image host to storefront `next.config.js` so customer menu images render through `next/image`
- Regenerated `.next` type files with `next typegen` after the storefront route cleanup
- Replaced hardcoded storefront menu tabs with live category tabs from `menu_categories`, so customer navigation now reflects real categories such as `Beef`, `Chicken`, `Goat`, and `Drinks`

Verification completed:

- `npx.cmd tsc --noEmit` passes in the storefront repo
- `npm.cmd run build` passes in the storefront repo
- `npm.cmd run build` passes in the admin repo

Important current dependency:

- The storefront's shared-order flow depends on Phase 10 being applied in Supabase before live customer order creation and tracking can fully work

Commit reference:

- Git commit `e893242` migrates the storefront to the shared Supabase schema
- Git commit `59096e6` switches storefront menu tabs to live Supabase categories

## PWA Rollout

Status: implemented in both Smokehouse repos, pushed to `main`, and verified with TypeScript and production builds

Reference repos used for scope:

- Storefront PWA reference: `C:\Users\Jurugo\OneDrive\VS Code\Web Development\kira_bakery`
- Admin PWA reference: `C:\Users\Jurugo\OneDrive\VS Code\Web Development\kira-bakery-admin`

Storefront PWA updates:

- Replaced the older lightweight storefront service worker setup with a fuller Kira-style PWA registration pattern
- Added `components/pwa-register.tsx`
- Updated `app/layout.tsx` to register the service worker directly in React instead of using `public/sw-register.js`
- Replaced `public/manifest.json` with `public/manifest.webmanifest`
- Replaced `public/sw.js` with a stronger cache strategy for shell, runtime assets, images, and an offline fallback
- Added `app/offline/page.tsx`
- Removed `public/sw-register.js`

Admin PWA updates:

- Added `app/manifest.ts`
- Added `components/pwa/service-worker-registration.tsx`
- Added `lib/pwa/service-worker.ts`
- Added `public/sw.js`
- Added `app/offline/page.tsx`
- Updated `app/layout.tsx` with installable app metadata, icons, and service worker registration
- Copied Smokehouse install icons into `public/icons`

Verification completed:

- `npx.cmd tsc --noEmit` passes in the storefront repo
- `npx.cmd tsc --noEmit` passes in the admin repo

## Menu Portion Quick Add

Status: implemented locally in the admin repo and ready to ship

What changed:

- Added inline portion-type creation to the Menu card `New Menu Item` form so staff can create a new portion without leaving the page
- The quick-add flow follows the same mini-form pattern already used for inline supplier creation
- Portion codes are generated automatically from the entered name using the shared code helper
- Spaces and separators normalize to underscores, so entries like `Kachumbari Salad` become `kachumbari_salad`
- The quick-add form captures:
  `name`
  and
  `grams`
- The saved portion label is generated as a weight-based size such as `250g` or `300g`
- New inline-created portions are inserted as active `portion_types`, immediately added to the dropdown, and auto-selected for the menu item being created
- This supports weight-based sides and specials like `kachumbari` without needing protein or packaging links

Audit result:

- The existing Menu page already had the right client-side shape for an inline add pattern, but it did not have a portion-type creation action
- The shared `toCode(...)` helper already matched the desired code rule:
  lowercase
  spaces to underscores
  and repeated separators collapsed
- The `portion_types` schema allows nullable `protein_id` and `packaging_type_id`, so weight-based custom portions can be added without forcing those relations

Verification note:

- A full repo `npx.cmd tsc --noEmit` run is still blocked by the repo's existing missing `.next/dev/types/*` and placeholder-file issues, so final typecheck verification for this change remains limited on this machine

## Launch Reminder: Remove Localhost Bypass

Status: reminder logged for pre-launch cleanup

Before launch:

- Review and remove localhost-only auth and RLS bypass behavior if it is no longer needed for development
- Re-check admin reads to ensure production behavior depends on the intended authenticated session path only
- Confirm no localhost-specific bypass messaging or fallback access paths remain in the shared app code

Files to review first:

- `lib/auth/local-bypass.ts`
- `lib/ops/queries.ts`
- `app/(admin)/layout.tsx`

## Phase 22: Admin RLS Lockdown

Status: implemented locally in the admin repo and ready to apply after Phase 21

Scope:

- Added a Smokehouse admin role foundation with:
  `public.app_role`,
  `public.profiles`,
  `public.current_profile_role()`,
  `public.has_role(...)`,
  and
  `public.handle_new_user()`
- Backfilled existing `auth.users` into `public.profiles` with default `staff` roles so RLS can be enforced immediately
- Enabled row-level security across the admin-side schema, including:
  reference tables,
  menu tables,
  stock tables,
  procurement tables,
  orders,
  payment attempts,
  incidents,
  and
  suppliers
- Added admin-account-only policies so only authenticated users with Smokehouse admin roles can read or mutate those tables directly
- Locked profile-role management down further so profile reads are self-or-admin/manager and role-changing writes remain admin-only

Rollout note:

- This phase is intentionally admin-only for now
- Public storefront and regular customer RLS policies still need a separate follow-up pass before anon or customer direct access should be relied on

## Shared Orders Realtime

Status: implemented locally in the admin repo and ready to ship

Realtime updates:

- Added a browser-side Supabase singleton in `lib/supabase/browser.ts` so the admin dash shares one realtime client connection
- Added a shared orders realtime manager in `lib/ops/orders-realtime.ts`, modeled after the bakery admin pattern of one shared channel with multiple page consumers
- Added `components/ops/use-orders-realtime.ts` so admin pages can subscribe once and debounce `router.refresh()` on `orders` and `order_items` changes
- Split the dashboard into a client `LiveDashboard` wrapper so `app/(admin)/dashboard/page.tsx` can hydrate a server snapshot and then stay live
- Split the orders list into a client `LiveOrdersPanel` wrapper so `app/(admin)/orders/page.tsx` refreshes in realtime without each screen opening its own channel
- Included fallback polling if the realtime channel errors or times out, matching the bakery-style safety net

Verification completed:

- `npx.cmd tsc --noEmit` passes in the admin repo

Schema rollout follow-up:

- Added `db/phase-23-orders-realtime-publication.sql`
- Updated `db/merged-live-schema.sql`
- The Phase 23 migration adds `public.orders` and `public.order_items` to the `supabase_realtime` publication so order inserts and item changes can reach the shared admin realtime channel

Localhost audit note:

- A later localhost-only audit showed that the deployed realtime wiring was already working after the publication rollout
- The remaining local failure was caused by RLS during localhost development, not by a missing shared realtime connection
- Localhost auth bypass was kept as the minimal dev-only follow-up so the Orders page and the Live Smokehouse View can read through the admin path while local auth is bypassed
- The orders page and the dashboard `Action now` lane still share the same browser-side Supabase realtime singleton and shared orders channel

## Finished Stock Processing Redesign

Status: implemented locally in the admin repo and ready for schema rollout

Operational redesign:

- Replaced the earlier same-day stock posting concept with a finished frozen stock model that matches the smokehouse workflow
- Kept Procurement focused on raw intake and supply receiving
- Added a Processing flow for converting received meat into finished pre-roasted frozen portions
- Added a Finished Stock view on the Procurement page so staff can see what is ready for future orders
- Removed the temporary idea of pushing meat receipts directly into `daily_stock`

Schema and server updates:

- Replaced the earlier phase 11 direction with `db/phase-11-finished-stock.sql`
- Added `public.finished_stock`
- Added `public.finished_stock_movements`
- Added `public.processing_batches`
- Added `public.process_procurement_receipt_to_finished_stock(...)`
- Fixed the PL/pgSQL row-variable lookup issue in the phase 11 migration by splitting the portion and protein lookups into separate `select ... into` statements

Code updates:

- Added `components/procurement/processing-batch-form.tsx`
- Updated `app/(admin)/procurement/page.tsx`
- Updated `components/procurement/protein-intake-form.tsx`
- Updated `lib/ops/types.ts`
- Updated `lib/ops/queries.ts`
- Updated `lib/ops/actions.ts`
- Removed the temporary sellable-stock posting form and shifted the Procurement page to processing and finished-stock language

Verification completed:

- `npm run build` passes in the admin repo

## Login Logo Layout Fix

Status: implemented locally in the admin repo and ready to ship

Login page updates:

- Reworked the login page logo wrapper so the square Firestone logo is no longer placed inside a wide rectangular crop area
- Switched the login page logo image rendering to `object-contain` so the full mark remains visible without stretching
- Updated both desktop and mobile login headers to use square logo containers with the brand text aligned to the right
- Preserved the existing login page structure while improving logo visibility and brand presentation

Verification completed:

- `npm run build` passes in the admin repo

## Procurement Page And Intake Workflow

Status: implemented locally in the admin repo and ready for schema rollout

Procurement updates:

- Added a dedicated `/procurement` admin page so receiving workflows no longer overload `/inventory`
- Added Procurement to admin navigation above Inventory and wired the route into auth protection and app shortcuts
- Added a protein intake workflow for beef, whole chicken, and goat meat deliveries
- Added live chicken yield planning with allocation validation so halves and quarters are planned from whole chickens without becoming simultaneous live sellable stock
- Added a supplies intake workflow for tracked inventory items such as Clamcraft boxes and butcher paper sheets
- Added recent procurement activity to show what came in, from whom, how much, and any chicken allocation plan

Schema and server updates:

- Added `db/phase-10-procurement.sql`
- Added `public.procurement_receipts`
- Added `public.record_procurement_receipt(...)` to log procurement receipts and post supply restocks into tracked inventory
- Updated procurement defaults so goat meat is received in `kg`, not by head
- Extended operations error handling so the procurement page can point to the new schema migration when missing

Code updates:

- Added `app/(admin)/procurement/page.tsx`
- Added `components/procurement/protein-intake-form.tsx`
- Added `components/procurement/supply-intake-form.tsx`
- Updated `lib/admin/nav.ts`
- Updated `components/dashboard/admin-sidebar.tsx`
- Updated `proxy.ts`
- Updated `app/manifest.ts`
- Updated `lib/ops/types.ts`
- Updated `lib/ops/queries.ts`
- Updated `lib/ops/actions.ts`
- Updated `lib/ops/errors.ts`

Verification completed:

- `npm run build` passes in the admin repo

## Resupplies And Inventory Simplification

Status: implemented locally in the admin repo and ready to ship

Workflow simplification updates:

- Shifted visible admin language from `Procurement` toward `Resupplies` so the page reads more naturally for non-technical staff
- Moved supply restock visibility into the Inventory experience so a resupply now shows up where staff expect to see stock changes
- Updated the Inventory page to show `Today's Protein Resupplies` using what was entered that day, instead of making staff infer everything from `daily_stock`
- Changed the customer-ready stock cards so they no longer present a wall of confusing zeroes when sellable stock has not been posted yet
- Added estimated sellable-portion calculations on the Inventory page so staff can see what today's receipts can become before full stock posting
- Added expected-yield guidance to the Processing form so common receipts such as beef `300g` portions and goat `350g` portions are auto-estimated from the raw quantity received

Chicken workflow simplification:

- Removed the chicken yield planning card from protein intake because it added complexity without matching real staff workflow
- Simplified whole-chicken intake back to raw receipt logging only
- Updated chicken processing so staff record the real finished output directly, while the database still honors old planned allocations if they already exist on older receipts

Code and schema updates involved:

- Updated `app/(admin)/inventory/page.tsx`
- Updated `app/(admin)/procurement/page.tsx`
- Updated `components/procurement/protein-intake-form.tsx`
- Updated `components/procurement/processing-batch-form.tsx`
- Added `lib/ops/yield.ts`
- Updated `lib/ops/queries.ts`
- Updated `lib/ops/actions.ts`
- Updated `lib/admin/nav.ts`
- Updated `components/dashboard/admin-sidebar.tsx`
- Updated `app/manifest.ts`
- Updated `db/phase-11-finished-stock.sql`

Verification completed:

- `npx.cmd tsc --noEmit` passes in the admin repo

## Phase 12: Split Red Meat Cuts

Status: implemented locally in the admin repo and ready for schema rollout

Why this phase was needed:

- Generic `beef` and `goat` receiving was too broad for the actual smokehouse workflow
- Staff need to enter ribs and chunks separately so the inventory story, expected sellable yield, and processing behavior all stay specific and understandable

What Phase 12 introduces:

- Future protein receipts are now entered as:
  `beef_ribs`, `beef_chunks`, `whole_chicken`, `goat_ribs`, and `goat_chunks`
- Goat sellable entries are now modeled explicitly as `goat_ribs_350g` and `goat_chunks_350g`
- The legacy `goat_chops` sellable entry is migrated into `goat_chunks_350g`
- Processing rules now enforce cut-specific matching so ribs process into ribs and chunks process into chunks
- Expected sellable-yield calculations now use the specific cut received instead of generic beef/goat family matching

Schema and migration updates:

- Added `db/phase-12-split-red-meat-cuts.sql`
- Updated `db/phase-10-procurement.sql`
- Updated `db/phase-11-finished-stock.sql`
- Updated `db/phase-01-reference-tables.sql`
- Updated `db/phase-04-go-live-bootstrap.sql`
- Updated `db/phase-05-packaging-inventory-bootstrap.sql`
- Updated `db/phase-06-menu-prices-and-activation.sql`
- Updated `db/merged-live-schema.sql`

What the live migration does:

- Renames legacy `goat_chops` portion/menu records into `goat_chunks_350g` where needed
- Inserts or updates `goat_ribs_350g`
- Refreshes menu packaging links for the goat ribs and goat chunks items
- Replaces the procurement protein-code constraint to allow the new cut-specific receipt codes
- Replaces `public.record_procurement_receipt(...)` so raw intake is stored with the new codes
- Replaces `public.process_procurement_receipt_to_finished_stock(...)` so finished-stock processing follows the new ribs/chunks split
- Preserves legacy generic `beef` and `goat` codes so older receipt history still loads safely

App updates tied to Phase 12:

- Updated `components/procurement/protein-intake-form.tsx`
- Updated `components/procurement/processing-batch-form.tsx`
- Updated `lib/ops/types.ts`
- Added `lib/ops/yield.ts`
- Updated `lib/ops/queries.ts`

Verification completed:

- `npx.cmd tsc --noEmit` passes in the admin repo

Operational rollout note:

- Existing Supabase environments should run `db/phase-12-split-red-meat-cuts.sql` after the current Phase 11 file so the live database matches the new cut-specific intake and processing flow

## Phase 13: Supplier Traceability And Sides

Status: implemented locally in the admin repo, applied via the modified Phase 13 SQL file, and ready for app-side follow-through

Why this phase was needed:

- Protein receiving needed stronger supplier and batch traceability for real procurement operations
- The menu needed side portions added into the same operational model instead of living outside the main schema flow
- Beef ribs and beef chunks both needed to move from `350g` to `300g` in a way that would not break existing live records

What Phase 13 introduces:

- Supplier master records for procurement workflows
- Supplier-linked protein receipts with batch and inspection traceability fields
- Side menu portions for `fries_250g` and `gonja_250g`
- Live migration support for:
  `beef_ribs_350g` -> `beef_ribs_300g`
  `beef_chunks_350g` -> `beef_chunks_300g`

Schema and migration updates:

- Added `db/phase-13-supplier-traceability-and-sides.sql`
- Updated `db/phase-01-reference-tables.sql`
- Updated `db/phase-04-go-live-bootstrap.sql`
- Updated `db/phase-05-packaging-inventory-bootstrap.sql`
- Updated `db/phase-06-menu-prices-and-activation.sql`
- Updated `db/phase-11-finished-stock.sql`
- Updated `db/merged-live-schema.sql`

What the live migration does:

- Adds `public.suppliers`
- Extends `public.procurement_receipts` with supplier, batch, butchered-date, abattoir, vet-stamp, and inspection-officer traceability fields
- Renames or inserts beef portion/menu records so beef ribs and beef chunks are now `300g`
- Adds side portion and menu records for fries and gonja
- Refreshes packaging links for beef ribs, beef chunks, fries, and gonja
- Replaces `public.record_procurement_receipt(...)` with the supplier-aware traceability version
- Replaces `public.process_procurement_receipt_to_finished_stock(...)` so finished-stock processing follows the updated beef `300g` portion codes

Operational rollout note:

- Existing Supabase environments should now run `db/phase-13-supplier-traceability-and-sides.sql`
- This Phase 13 file supersedes the earlier recommendation to stop at `db/phase-12-split-red-meat-cuts.sql` for the latest live schema direction

## Phase 14: Processing Yield Weight

Status: implemented locally in the admin repo and ready for schema rollout

Why this phase was needed:

- The system already stored raw receipt weight and final portion count, but it did not store the real intermediate packed weight after roasting and vacuum packing
- That post-roast packed weight is the operational truth needed to measure yield properly and trace how raw intake becomes sellable frozen stock

What Phase 14 introduces:

- `processing_batches.post_roast_packed_weight_kg`
- `processing_batches.yield_percent`
- Processing-flow support for storing the packed weight alongside the finished portion count
- UI support for staff to enter post-roast packed weight during processing
- Automatic expected-portion estimation from:
  `floor(post_roast_packed_weight_kg / portion_size_kg)`

Schema and migration updates:

- Added `db/phase-14-processing-yield-weight.sql`
- Updated `public.process_procurement_receipt_to_finished_stock(...)` to accept `post_roast_packed_weight_kg`
- Kept `post_roast_packed_weight_kg` nullable so older batches remain valid
- Added `yield_percent` as a stored derived value populated during processing when both raw and post-roast weights are available

App updates tied to Phase 14:

- Updated `components/procurement/processing-batch-form.tsx`
- Updated `lib/ops/actions.ts`
- Updated `lib/ops/types.ts`
- Updated `lib/ops/queries.ts`
- Updated `app/(admin)/procurement/page.tsx`

Current processing behavior:

- Raw receipt weight is displayed read-only during processing
- Staff enter post-roast packed weight in kilograms
- The form pre-fills `quantity_produced` from packed weight and portion size when weight-based portion math is possible
- Staff can still override the final portion count if the real packed output differs from the estimate
- Existing older processing batches without packed weight still render safely

How yield is computed:

- `yield_percent = (post_roast_packed_weight_kg / raw_weight_kg) * 100`
- It is only stored when:
  `post_roast_packed_weight_kg` exists,
  raw receipt weight exists,
  and raw receipt weight is greater than zero

Operational rollout note:

- Existing Supabase environments should run `db/phase-14-processing-yield-weight.sql` after the current Phase 13 file

Verification completed:

- `npx.cmd tsc --noEmit` passes in the admin repo

Verification still blocked locally:

- `npm.cmd run build` reaches the Next.js build and compile stages, but this machine currently fails later with `spawn EPERM`

## Pending Change: Frozen Sellable Stock Business Logic

Status: pending design and implementation

Why this change is pending:

- The intended Smokehouse inventory model is based on post-roast, vacuum-packed, blast-chilled or blast-frozen sellable stock, not raw meat intake
- Raw procurement receipts still matter for supplier traceability and food-safety follow-up, but they should not be the inventory layer deducted by customer orders

Target operational flow:

- Raw meat is bought and logged as a procurement batch
- The system should auto-generate procurement batch numbers for traceability instead of depending only on manual entry
- Meat is chopped into the target cut and portion workflow
- Meat is roasted to almost ready
- Meat is vacuum-packed, then blast chilled or blast frozen for storage
- A second weighing happens after roasting and vacuum packing
- That second post-roast packed weight is the weight that should drive sellable frozen inventory
- Customer orders should deduct from frozen packaged sellable stock
- Fulfillment should then follow the real service flow:
  frozen stock out -> thaw -> light grill finish -> final handoff packing such as butcher paper

Processing and inventory implications:

- Processing batches should link raw intake to finished frozen sellable output
- Processing should capture wet-weight loss between raw intake and post-roast packed output
- Processing should capture expected revenue from the resulting roasted frozen sellable stock
- Inventory visibility for admins should answer:
  how much roasted frozen sellable stock exists now,
  how much raw weight was lost during processing,
  and what revenue is expected from the processed batch output

Traceability requirement:

- Batch numbers should make it possible to track how long a batch took to sell
- Batch numbers should support food-safety investigation if customers later report health issues tied to a batch

## Pending UX Change: Inline Supplier Creation In Procurement

Status: implemented locally in the admin repo and ready to ship

Why this change was needed:

- Requiring staff to leave Procurement and visit a separate Suppliers page creates unnecessary delay during busy receiving periods
- The current workflow is too rigid for rush-hour operations

What is now implemented:

- Procurement now allows quick supplier creation directly inside the protein intake workflow
- Staff can create a supplier and immediately use it without leaving the Resupplies page
- The separate Suppliers page still remains available for fuller record management
- The first implementation uses an inline quick-add panel inside Procurement rather than a modal so the workflow stays fast and simple

Files updated:

- `components/procurement/protein-intake-form.tsx`
- `lib/ops/actions.ts`

Verification completed:

- `npx.cmd tsc --noEmit` passes in the admin repo

## Procurement Reliability And Batch Automation

Status: implemented locally in the admin repo and ready to ship

What was updated:

- Intermittent `daily_stock` RPC failures on `/inventory` now get one retry before surfacing as an error
- The inventory page can now fall back more gracefully when `get_daily_menu_stock(...)` hits a transient transport failure
- Operations error formatting now preserves richer Supabase details such as `details`, `hint`, `code`, and nested causes
- Protein receipt batch numbers on the Resupplies page are now generated by the system instead of typed manually by staff
- The protein intake form now shows batch-number generation as automatic, while preserving traceable unique receipt batch IDs in stored procurement records

Files updated:

- `lib/ops/queries.ts`
- `lib/ops/errors.ts`
- `lib/ops/actions.ts`
- `components/procurement/protein-intake-form.tsx`

Implementation note:

- Protein batch numbers are currently generated in the app server action using the protein code, delivery date, and Kampala time in a short format such as `BEEF_RIBS-20260417-1422`
- This improves day-to-day intake speed now while still aligning with the longer-term goal of stronger traceability automation

Verification completed:

- `npx.cmd tsc --noEmit` passes in the admin repo

## Phase 14: Processing Yield Weight

Status: implemented locally in the admin repo and ready for schema rollout

Why this phase was needed:

- The processing workflow needed to capture the real post-roast packed weight between raw intake and final sellable portion count
- Raw receipt weight alone was not enough to measure roast loss and true packed yield
- Portion count still matters operationally, but it should now be traceable back to the packed weight that existed before portioning

What Phase 14 introduces:

- `public.processing_batches.post_roast_packed_weight_kg`
- `public.processing_batches.yield_percent`
- Processing flow support for saving packed post-roast weight during receipt-to-finished-stock conversion
- Processing UI support for entering packed weight and using it to estimate expected portions

Schema and migration updates:

- Added `db/phase-14-processing-yield-weight.sql`
- Updated `public.process_procurement_receipt_to_finished_stock(...)` so it accepts and stores `post_roast_packed_weight_kg`
- Updated the processing function so `yield_percent` is derived when both raw and packed weights exist

App updates tied to Phase 14:

- Updated `components/procurement/processing-batch-form.tsx`
- Updated `lib/ops/actions.ts`
- Updated `lib/ops/types.ts`
- Updated `lib/ops/queries.ts`
- Updated `app/(admin)/procurement/page.tsx`

Important processing behavior now implemented:

- Staff can see the raw receipt weight as a read-only value while processing
- Staff can enter the post-roast packed weight in kilograms
- The form now auto-estimates expected portions from packed weight using the selected portion size where applicable
- `quantity_produced` remains editable so staff can correct the final count if the packed-weight estimate does not exactly match reality
- Finished stock creation still uses `quantity_produced`, not packed weight directly

Yield calculation now used:

- `yield_percent = (post_roast_packed_weight_kg / raw_weight_kg) * 100`
- Yield is only stored when both weights exist and the raw receipt weight is greater than zero

Backwards compatibility note:

- Older processing batches remain valid because `post_roast_packed_weight_kg` is nullable
- Processing history rendering still works when older rows do not have packed-weight or yield data

Verification completed:

- `npx.cmd tsc --noEmit` passes in the admin repo

Verification still blocked locally:

- `npm.cmd run build` reaches the build pipeline, but this machine still hits a local `spawn EPERM` failure before the full build can complete

## Phase 15: Goat 300g Normalization

Status: implemented locally in the admin repo and ready for schema rollout

Why this phase was needed:

- Goat ribs and goat chunks needed to move to the same `300g` sellable target used for beef
- Leaving goat at `350g` while beef had already moved to `300g` would keep packaging, processing, and menu logic inconsistent
- Existing live environments still needed a safe forward migration instead of a clean-slate assumption

What Phase 15 introduces:

- Goat sellable entries now move from `goat_ribs_350g` and `goat_chunks_350g` to:
  `goat_ribs_300g`
  `goat_chunks_300g`
- Live migration support for renaming existing goat portion and menu records where needed
- Processing rules updated so goat receipts only process into the new `300g` goat sellable codes

Schema and migration updates:

- Added `db/phase-15-goat-300g.sql`
- Updated `db/phase-01-reference-tables.sql`
- Updated `db/phase-04-go-live-bootstrap.sql`
- Updated `db/phase-05-packaging-inventory-bootstrap.sql`
- Updated `db/phase-06-menu-prices-and-activation.sql`
- Updated `db/phase-11-finished-stock.sql`
- Updated `db/phase-13-supplier-traceability-and-sides.sql`
- Updated `db/phase-14-processing-yield-weight.sql`
- Updated `db/merged-live-schema.sql`

App updates tied to Phase 15:

- Updated `lib/ops/yield.ts`

What the live migration does:

- Renames `goat_ribs_350g` to `goat_ribs_300g` where a new `300g` record does not already exist
- Renames `goat_chunks_350g` to `goat_chunks_300g` where a new `300g` record does not already exist
- Ensures the goat portion labels are updated to `300g`
- Renames matching goat menu item codes to the new `300g` codes where needed
- Replaces `public.process_procurement_receipt_to_finished_stock(...)` so goat ribs and goat chunks only process into the new `300g` goat sellable entries

Operational rollout note:

- Existing Supabase environments should now run `db/phase-15-goat-300g.sql`
- This phase should be applied after the current Phase 14 file so live goat portion/menu records and processing rules align with the new `300g` standard

Verification completed:

- `npx.cmd tsc --noEmit` passes in the admin repo

## Phase 16: Chicken Processing Allocation

Status: implemented locally in the admin repo and ready for schema rollout

Why this phase was needed:

- Whole chicken does not fit the packed-weight-first processing workflow used for beef and goat
- Chicken processing needed to reflect the real operational decision of splitting birds into halves versus quarters in one batch
- Staff needed a linked allocator that guarantees the full receipt is accounted for without reprocessing leftovers

What Phase 16 introduces:

- A whole-chicken-specific processing path based on bird allocation instead of packed weight
- A new database function:
  `public.process_whole_chicken_receipt_allocation(...)`
- Processing behavior where one whole chicken receipt is allocated fully between halves and quarters in one event
- Updated validation so the older beef/goat processing function explicitly rejects `whole_chicken`

Schema and migration updates:

- Added `db/phase-16-chicken-processing-allocation.sql`
- Updated `db/merged-live-schema.sql`

App updates tied to Phase 16:

- Updated `components/procurement/processing-batch-form.tsx`
- Updated `lib/ops/actions.ts`
- Updated `lib/ops/queries.ts`

Important chicken allocation behavior now implemented:

- Whole chicken processing now shows two linked inputs:
  `birds_allocated_to_halves`
  `birds_allocated_to_quarters`
- Editing one side automatically fills the remaining birds on the other side
- The allocator enforces full receipt accounting so:
  halves birds + quarters birds = total birds received
- Sellable output is derived automatically as:
  `produced_half_count = birds_allocated_to_halves * 2`
  `produced_quarter_count = birds_allocated_to_quarters * 4`
- Chicken receipts still become closed/non-actionable in the processing dropdown after processing, matching the existing processed-receipt behavior

Strict SQL validation now enforced:

- `birds_allocated_to_halves >= 0`
- `birds_allocated_to_quarters >= 0`
- Neither allocation can exceed the total birds on the receipt
- Both allocations together must equal the total birds on the receipt
- Whole chicken receipts must carry a positive whole-number bird count
- Already processed chicken receipts cannot be processed again

Backwards compatibility note:

- No new table columns were required
- Existing receipt allocation fields were reused:
  `allocated_to_halves`
  `allocated_to_quarters`
- Beef and goat packed-weight processing remains unchanged
- Existing chicken receipts remain valid and are now processed through the allocation path

Verification completed:

- `npx.cmd tsc --noEmit` passes in the admin repo

## Suppliers Page History UX

Status: implemented locally in the admin repo and ready to ship

Why this change was needed:

- Supplier intake history was too fragmented and required too much scrolling to review
- Staff needed to see supplier, item, batch, quantity, and intake date at a glance without digging through separate panels
- Saved supplier cards also needed to stay compact by default so the side column would not become a long static wall

What was updated:

- Reworked the main Suppliers page card so it is now a unified supply-history feed instead of a selected-supplier-only detail area
- Updated each supply-history card so the visible collapsed hierarchy is:
  supplier name,
  item name,
  then compact intake metadata such as batch number, quantity, date, and abattoir
- Included protein, chicken, and non-protein receipts in the same unified history stream
- Added inline expand/collapse behavior for supply-history cards using the same lightweight pattern direction as the Kira bakery admin recent-order cards
- Added a search field so staff can quickly find a supplier, item, batch number, abattoir, or note
- Moved saved supplier records into the side column and changed them into collapsed mini cards by default
- Updated saved supplier mini cards so clicking one expands inline to reveal supplier details and a direct open action

Files updated:

- `app/(admin)/suppliers/page.tsx`
- `components/suppliers/supplier-supply-history.tsx`
- `components/suppliers/saved-suppliers-list.tsx`
- `lib/ops/queries.ts`
- `lib/ops/types.ts`

Important current behavior:

- The main history feed is no longer limited to the currently selected supplier
- Every history card now shows the supplier name prominently first so intake history can be scanned in one place
- The side supplier list stays compact until a specific supplier card is expanded
- The selected supplier edit form still remains available in the side column when a supplier is opened

Verification completed:

- `npx.cmd tsc --noEmit` passes in the admin repo

## Procurement Non-Consumables Card

Status: implemented locally in the admin repo and ready to ship

Why this change was needed:

- After the stock reset, packaging items such as Clamcraft boxes and butcher paper needed a fast way to be restocked again
- The Procurement page was still spending right-sidebar space on a static `How It Works` card instead of a useful operational tool
- Non-consumables already had backend and schema support, but the page was not exposing that workflow where staff needed it

What was updated:

- Replaced the Procurement page `How It Works` sidebar card with the live supply-intake workflow
- Wired the existing supply intake form directly into the Procurement page so non-consumables can be restocked there
- Updated the page copy so Procurement now clearly covers:
  raw meat receiving,
  finished-stock processing,
  and non-consumable resupplies
- Changed the non-consumables form layout so its inputs stack vertically instead of sitting side by side

Files updated:

- `app/(admin)/procurement/page.tsx`
- `components/procurement/supply-intake-form.tsx`

Important current behavior:

- Tracked supply items such as Clamcraft boxes and butcher paper can now be restocked directly from Procurement
- The form still uses the existing supply receipt and inventory adjustment flow under the hood
- Supply inputs are now shown one over the other for a simpler receiving layout

Verification completed:

- `npx.cmd tsc --noEmit` passes in the admin repo

## Non-Consumables Quick Add Workflow

Status: implemented locally in the admin repo and ready to ship

Why this change was needed:

- Staff should not have to leave the non-consumables receiving flow just to create a missing supplier
- The same receiving card also needed to support adding new tracked supply items such as paper cups or straws without switching over to the separate inventory-item panel
- The card label needed to reflect what the workflow is actually doing instead of using the vaguer `Supply Resupply` wording

What was updated:

- Extended the non-consumables receiving form so saved `supply` and `mixed` suppliers can be selected directly in the card
- Added inline quick-add supplier creation above the supplier selector for non-consumables intake
- Added inline quick-add tracked-item creation above the tracked-item selector so new inventory items can be created and used immediately
- Updated supply receipt posting so non-consumables can now be recorded against `supplier_id` instead of only free-text supplier names
- Renamed the card eyebrow from `Supply Resupply` to `Non-Consumable Receiving`

Files updated:

- `app/(admin)/inventory/page.tsx`
- `app/(admin)/procurement/page.tsx`
- `components/procurement/supply-intake-form.tsx`
- `lib/ops/actions.ts`
- `lib/ops/queries.ts`
- `lib/ops/types.ts`

Important current behavior:

- Staff can create a non-consumables supplier inline and the new supplier is selected immediately for the current receipt
- Staff can create a tracked item inline and the new item is selected immediately for the current receipt
- The receiving flow now works even when no tracked items exist yet, because the first tracked item can be created directly inside the card
- Supply receipts still use the existing procurement receipt and inventory adjustment flow under the hood

Verification note:

- Full `npx.cmd tsc --noEmit` verification is currently blocked by existing missing `components/suppliers/*.tsx` files already referenced by the repo `tsconfig.json`

## Phase 17: Ingredient Intake

Status: implemented locally in the admin repo and ready for schema rollout

Why this phase was needed:

- Fries and gonja are food-side inputs, not raw protein and not the same kind of stock as non-food supplies such as cups or butcher paper
- Treating all non-protein receiving as `supply` would blur reporting and make future stock conversion rules harder to reason about
- The Procurement page needed a dedicated intake card for side ingredients above the non-consumables receiving workflow

What Phase 17 introduces:

- A third procurement intake type: `ingredient`
- `inventory_items.item_type` so tracked items are explicitly classified as `ingredient` or `supply`
- Seeded ingredient-tracked items for `fries_kg` and `gonja_kg`
- A new `Sides Intake` card on the Procurement page above `Non-Consumable Receiving`
- Inline quick-add support inside the sides card for both missing suppliers and missing tracked side items

Schema and migration updates:

- Added `db/phase-17-ingredient-intake.sql`
- Updated `db/merged-live-schema.sql`

What the live migration does:

- Adds `public.inventory_items.item_type`
- Backfills existing tracked items to `supply`
- Seeds `fries_kg` and `gonja_kg` as `ingredient` inventory items
- Expands `public.procurement_receipts.intake_type` so it supports `ingredient`
- Updates `public.record_procurement_receipt(...)` so ingredient receipts use tracked inventory items and post into inventory like other non-protein intake
- Validates that `ingredient` receipts can only target ingredient items and `supply` receipts can only target supply items

App updates tied to Phase 17:

- Added `components/procurement/sides-intake-form.tsx`
- Updated `app/(admin)/procurement/page.tsx`
- Updated `components/procurement/supply-intake-form.tsx`
- Updated `lib/ops/actions.ts`
- Updated `lib/ops/queries.ts`
- Updated `lib/ops/types.ts`

Important current behavior:

- The Procurement page now separates:
  `Protein Intake`,
  `Sides Intake`,
  and
  `Non-Consumable Receiving`
- Side inputs like fries and gonja are now modeled as ingredient intake, not generic supplies
- Non-consumables intake still handles packaging and operational supplies only
- Both the sides and non-consumables cards can create missing tracked items inline and use them immediately
- Batch numbers are now auto-generated for ingredient intake from the tracked item code, delivery date, and Kampala save time, following the same pattern as protein receipts

## Procurement Batch Number Expansion

Status: implemented locally in the admin repo and ready to ship

Why this change was needed:

- Protein intake already generated receipt batch numbers automatically, but fries, gonja, and other tracked consumables were still saving without batch identifiers
- Side ingredients are especially likely to need quick batch traceability during kitchen use and supplier follow-up
- Staff should not have to invent or type batch references for routine intake flows

What was updated:

- Extended server-side batch number generation beyond protein receipts to ingredient and supply procurement receipts
- Updated `Sides Intake` to preview the auto-generated batch number before save
- Updated `Non-Consumable Receiving` to preview the same auto-generated batch format before save
- Kept batch generation server-owned so the saved receipt still uses the canonical tracked item code from the database

Important current behavior:

- Protein receipts still generate batch numbers from protein code, delivery date, and Kampala time
- Ingredient and supply receipts now generate batch numbers from tracked item code, delivery date, and Kampala time
- Fries, gonja, and other tracked edible inputs now save with a batch number automatically

Verification note:

- Full `npx.cmd tsc --noEmit` verification is still blocked by existing missing `components/suppliers/*.tsx` files already referenced by the repo `tsconfig.json`

## Phase 18: Supplier Intake Segmentation

Status: implemented locally in the admin repo and ready for schema rollout

Why this phase was needed:

- Side-input suppliers should not appear inside the non-consumables receiving list
- Reusing `supply` suppliers for both ingredient intake and operational supplies would make supplier dropdowns noisy as records grow
- The supplier model needed to mirror the intake split introduced in Phase 17

What Phase 18 introduces:

- A dedicated `ingredient` supplier type alongside `protein`, `supply`, and `mixed`
- Procurement-page supplier filtering so:
  `Sides Intake` only sees `ingredient` and `mixed`
  while
  `Non-Consumable Receiving` only sees `supply` and `mixed`
- Sides quick-add supplier creation now saves new records as `ingredient` suppliers instead of `supply`

Schema and migration updates:

- Added `db/phase-18-supplier-intake-segmentation.sql`
- Updated `db/phase-13-supplier-traceability-and-sides.sql`
- Updated `db/merged-live-schema.sql`

What the live migration does:

- Expands `public.suppliers.supplier_type` so it supports `ingredient`
- Replaces the supplier-type check constraint with the new segmented version
- Reclassifies obvious existing side suppliers from `supply` to `ingredient` when they only have ingredient receipts

App updates tied to Phase 18:

- Updated `app/(admin)/procurement/page.tsx`
- Updated `components/procurement/sides-intake-form.tsx`
- Updated `components/procurement/protein-intake-form.tsx`
- Updated `app/(admin)/suppliers/page.tsx`
- Updated `lib/ops/types.ts`
- Updated `lib/ops/queries.ts`

Important current behavior:

- Ingredient suppliers no longer leak into the non-consumables receiving dropdown
- Mixed suppliers still remain available anywhere they make operational sense
- Existing suppliers that truly serve multiple lanes should be set to `mixed` instead of being duplicated

## Procurement Card Collapse Pass

Status: implemented locally in the admin repo

Why this change was needed:

- The Procurement page right column was getting too tall and scroll-heavy once side intake, non-consumables, finished stock, processing history, and recent activity were all visible at once
- Staff needed a quicker way to keep secondary panels tucked away until they were actually needed

What was updated:

- `Sides Intake` now starts collapsed by default
- `Non-Consumable Receiving` now starts collapsed by default
- `Recent Protein Activity`, `Finished Frozen Stock`, and `Processing History` now also start collapsed by default
- These cards now expand and collapse by clicking the card header itself instead of using separate expand/collapse buttons
- Added a reusable procurement collapsible card wrapper for the read-only summary cards

Files updated:

- Added `components/procurement/collapsible-card.tsx`
- Updated `components/procurement/sides-intake-form.tsx`
- Updated `components/procurement/supply-intake-form.tsx`
- Updated `app/(admin)/procurement/page.tsx`

Important current behavior:

- The Procurement page now loads in a more compact state with the right column mostly collapsed
- Intake cards and activity/history cards use the same click-to-expand pattern
- Collapsed cards still show short guidance text so staff know what each card is for before opening it

## Storefront Stock-Aware Availability

Status: implemented locally in the storefront repo and ready to ship

Storefront repo:

- `C:\Users\Jurugo\OneDrive\VS Code\Web Development\thesmokehouse`

Why this change was needed:

- Storefront menu availability was still trusting only manual menu flags instead of real sellable stock
- Zero-stock items were disappearing from the practical ordering flow instead of staying visible with an inactive state
- Customers also needed low-stock visibility when only a small number of sellable portions remained

What was updated:

- Storefront menu loading now derives sellable availability from stock instead of only from `is_active` and `is_available_today`
- The stock source of truth now prefers today's `daily_stock.remaining_quantity` when present for a menu item's `portion_type_id`
- When no same-day `daily_stock` row exists, the storefront now falls back to `finished_stock.current_quantity`
- Menu cards now remain visible when an item is active and available today even if stock has reached zero
- The storefront `Add` button now disables automatically when sellable units are `0`
- Zero-stock items now show an explicit `Out of stock` state instead of disappearing
- Items with sellable units from `1` through `10` now show a low-stock message such as `Only X left`
- Checkout validation now rejects zero-stock items and also rejects requests whose requested quantity exceeds current sellable units
- Added a shared storefront stock helper so the menu page and menu API use the same stock derivation logic

Files updated in the storefront repo:

- `app/page.tsx`
- `app/api/menu/route.ts`
- `app/api/orders/route.ts`
- `components/menu-client.tsx`
- `lib/shared-schema.ts`
- `lib/types.ts`
- `lib/menu-stock.ts`

Important current behavior:

- Menu visibility still respects:
  `is_active`
  and
  `is_available_today`
- Stock now controls orderability rather than whether the card exists on screen
- Items with `0` sellable units stay visible but cannot be added to cart
- Items with `10` or fewer sellable units remain orderable while showing low-stock feedback

Verification completed:

- `npx.cmd tsc --noEmit` passes in the storefront repo
- `npm.cmd run build` passes in the storefront repo

## Phase 20: Fries Direct-Sellable Procurement

Status: implemented locally in the admin repo and ready for schema rollout

Why this phase was needed:

- Frozen fries arrive pre-packed and pre-frozen, so they should not wait behind the raw-input-to-processing path
- The prior ingredient-intake workflow only restocked `fries_kg` as tracked input inventory, which meant fries procurement did not show up as sellable stock on the Inventory page
- Gonja follows a different operational path and is intentionally excluded until proprietors confirm the intake and ripening workflow

What Phase 20 introduces:

- A fries-only direct-sellable rule inside procurement receipt posting
- `fries_kg` ingredient receipts now credit `fries_250g` sellable stock immediately
- The procurement receipt itself is still saved first, so supplier, batch, date, and note history remain intact for audit and traceability
- Direct-sellable fries receipts now also write a matching `finished_stock_movements` adjustment entry instead of only changing stock totals silently
- Same-day fries `daily_stock.starting_quantity` is also increased when a day-stock row already exists, so the Inventory page reflects the receipt right away in initialized service-day views
- Gonja remains on the existing ingredient-input path for now

Schema and migration updates:

- Added `db/phase-20-fries-direct-sellable.sql`
- Updated `db/merged-live-schema.sql`

What the live migration does:

- Replaces `public.record_procurement_receipt(...)` with a version that special-cases `ingredient` receipts for `fries_kg`
- Looks up the active `fries_250g` portion type and raises an error if that sellable target is missing or inactive
- Converts received fries weight into sellable quantity with the temporary rule:
  `floor(quantity_received / 0.25)`
- Requires at least enough received weight to create one `250g` portion before the receipt can complete
- Inserts or increments the matching `public.finished_stock` row for `fries_250g`
- Logs the direct fries receipt in `public.finished_stock_movements`
- Updates same-day `public.daily_stock.starting_quantity` only when that day and portion row already exists and has already been initialized with activity
- Leaves non-fries ingredient receipts and all supply receipts on their prior inventory-adjustment path

App updates tied to Phase 20:

- Updated `components/procurement/sides-intake-form.tsx`
- Updated `lib/ops/queries.ts`

Important current behavior:

- Receiving fries by weight on Procurement now creates immediate sellable `fries_250g` units using the temporary rule:
  `1 kg = 4 x 250g portions`
- These fries receipts do not also restock the `fries_kg` tracked ingredient quantity, to avoid maintaining duplicate stock truths for the same inventory
- Gonja intake is unchanged and still does not auto-convert into sellable portions

## Phase 21: Pesapal Paid-Only Reservation Foundation

Status: implemented locally across the admin and storefront repos and ready for schema rollout plus sandbox credential wiring

Why this phase was needed:

- Storefront orders should no longer reserve sellable stock before payment is actually verified
- Staff should not be responsible for manually confirming payment on the admin dashboard
- The order flow needed a clean split between:
  payment lifecycle
  and
  kitchen lifecycle

What Phase 21 introduces:

- Separate payment tracking on `public.orders`
- A dedicated `public.payment_attempts` table for Pesapal initiation and verification history
- A `service_date` stored on each order so paid reservations always hit the correct Uganda stock day
- Paid-only stock reservation through database functions instead of reserving during storefront order creation
- Order completion and cancellation paths that now finalize or release reserved stock consistently

Schema and migration updates:

- Added `db/phase-21-pesapal-paid-reservations.sql`
- Updated `db/merged-live-schema.sql`

What the live migration does:

- Adds order payment fields such as `payment_status`, `payment_provider`, `payment_reference`, `payment_redirect_url`, `order_tracking_id`, `paid_at`, and initiation-failure metadata
- Adds `service_date` and backfills existing orders from Uganda-local promised or created time
- Adds `public.payment_attempts`
- Adds `public.reserve_paid_order_stock(...)`
- Adds `public.release_reserved_order_stock(...)`
- Adds `public.finalize_reserved_order_sale(...)`
- Adds `public.mark_order_as_paid(...)`
- Replaces `public.transition_order_status(...)` so stock release/finalization happens on `cancelled` and `completed`
- Prevents operational forward movement into prep/ready/completed unless payment is already `paid`

Storefront updates tied to Phase 21:

- Added Pesapal sandbox helper code and explicit initiation-rejection handling
- Updated storefront order creation so new orders save as pending and immediately start payment instead of skipping straight to confirmed
- Added Pesapal callback, IPN, and payment-status routes
- Added a customer payment result page with:
  `success`,
  `pending`,
  `failed`,
  and
  `cancelled`
  states
- Updated checkout so the cart only clears after verified payment success instead of clearing immediately after order creation
- Updated customer order tracking so payment state is visible alongside the kitchen status

Admin updates tied to Phase 21:

- Updated live order reads to include payment state
- Updated dashboard/action prioritization so unpaid `new` orders no longer appear as immediate kitchen work
- Removed the manual `new -> confirmed` staff action by making `confirmed` the paid-entry state owned by payment verification
- Kept the intended staff-only operational steps as:
  `In Prep`,
  `Ready`,
  then
  pickup-code completion

Verification completed:

- `npx.cmd tsc --noEmit` passes in the storefront repo
- `npx.cmd tsc --noEmit` passes in the admin repo

Verification note:

- `npm.cmd run build` still reaches the post-compile Next.js build step in both repos and then fails with the same local Windows `spawn EPERM` environment issue, so final production-build verification remains blocked on this machine

## Admin Polish And Telemetry

Status: implemented locally in the admin repo and ready to ship

Admin updates:

- Removed the sidebar `Operational note` card from the admin dashboard navigation shell to reduce clutter
- Installed `@vercel/speed-insights`
- Wired `SpeedInsights` into `app/layout.tsx` so the admin app reports Vercel performance telemetry

Verification completed:

- `npx.cmd tsc --noEmit` passes in the admin repo
- `npm.cmd run build` passes in the storefront repo
- `npm.cmd run build` passes in the admin repo

Commit reference:

- Git commit `c3265cd` adds admin PWA support
- Git commit `c86004a` upgrades storefront PWA support

## Shared Branding And Icons

Status: implemented in both Smokehouse repos locally and ready to ship

Branding updates:

- `logo-bigger.jpg` from the storefront icons folder is now the visible main logo for both Smokehouse apps
- `logo-square.png` from the storefront icons folder is now the base favicon and install identity for both Smokehouse apps
- Real `icon-192.png` and `icon-512.png` files were generated from `logo-square.png` for both repos, replacing the earlier placeholder icon files

Storefront branding updates:

- Added `logo-bigger.jpg` to the storefront hero in `app/page.tsx`
- Updated `app/layout.tsx` so favicon and shortcut icons now point to `logo-square.png`
- Updated `public/manifest.webmanifest` so install metadata includes the new logo assets
- Updated `public/sw.js` asset caching and bumped the service worker cache version so devices pick up the new icons cleanly

Admin branding updates:

- Copied `logo-bigger.jpg` and `logo-square.png` into the admin repo `public/icons`
- Added `logo-bigger.jpg` to the admin sidebar, mobile nav header, drawer, and login page
- Updated `app/layout.tsx` and `app/manifest.ts` so favicon and install metadata use the new logo assets
- Updated `public/sw.js` asset caching and bumped the service worker cache version so the refreshed branding is picked up after deploy

Verification completed:

- `npx.cmd tsc --noEmit` passes in the storefront repo
- `npx.cmd tsc --noEmit` passes in the admin repo
