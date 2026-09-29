# Traveller POS rollout

The combined migration has been applied to the live database. Read-only verification found the four traveller food rows, preorder table, POS menu RPC, shared fries base, and universal soda bottle portion. The four traveller foods are active; regular water and Soda remain inactive. Do not rerun the one-time fries conversion. An operational order and restock smoke test is still outstanding.

## Order

`TRAVELLER-APPLY-ONCE.sql` was applied as one transaction. The numbered phase files are its source and are retained for review:

1. `phase-87-traveller-pos-products.sql` — POS-only products and requirements.
2. `phase-88-traveller-goat-allocation.sql` — 250 g goat processing output.
3. `phase-89-shared-fries-25g-units.sql` — converts the existing universal fries balance and today's/future daily counters from 225 g units into 25 g accounting units. This is the one-time stock conversion; do not rerun it.
4. `phase-90-traveller-preorder-stock.sql` — pending traveller stock holds.
5. `phase-91-traveller-preorder-creation.sql` — booking with payment now or on arrival.
6. `phase-92-traveller-preorder-arrival.sql` — arrival payment and check-in.
7. `phase-93-traveller-counter-sale.sql` — scoped traveller counter sales.
8. `phase-94-traveller-preorder-reconciliation.sql` — component-level stock and health reporting.
9. `phase-95-traveller-paid-cancellation-guard.sql` — unpaid cancellation and paid cancellation guard.
10. `phase-96-traveller-counted-components.sql` — counted salad and sauce servings plus the shared soda bottle pool.
11. `phase-97-traveller-beef-conversion.sql` — cooked beef conversion to counted skewers/samosas.

## Historical preflight checks

- Back up the current database and rehearse the exact migration sequence on that copy.
- Pause order taking while Phase 89 converts fries. It carries ordinary 225 g Fries reservations and all historical daily counters into the new unit. It aborts if any reserved sourced or composite fries product (including Large Fries) would need a different conversion. Confirm the old Fries intake still maps to the 225 g regular portion and that the 25 g base has no balance or daily rows.
- Confirm the 500 g large Fries serving will change from the current two 225 g units (450 g) to twenty 25 g units (500 g). Regular Fries uses nine units (225 g), traveller fries eight (200 g).
- Confirm regular juice is a 300 ml portion and water is a 500 ml portion. Only four traveller food products are private; activation is a separate operator step. Juice and water remain regular menu items; regular Soda is seeded inactive against one universal bottle balance.
- Deploy the paired storefront filter (`pos_only = false` in its local fallback) and the admin POS change together with the database migrations.

## Outstanding operational smoke test

1. Restock fries, regular juice/water, counted salad and sauce, and universal 330 ml soda bottles. Count soda bottles/cans and enter the cartons actually consumed. Record any tracked sauce cups actually consumed; existing raw cup stock is not migrated automatically.
2. Process a goat-chunks receipt with an explicit 250 g traveller allocation.
3. Convert physically verified unsold cooked beef portions into counted skewers and samosas. Verify the original portion falls and the new pieces rise by the entered counts. Batch age is guidance, with a recorded early-conversion acknowledgment.
4. Activate only traveller foods whose included requirements have sellable stock. Activate regular water and Soda when ready; these use their ordinary menu choices and shared physical stock. Confirm the four traveller foods appear in POS and remain absent from storefront menu and checkout.
5. Verify a combined preorder, an individual preorder, payment at booking, payment on arrival, an unpaid cancellation, and a counter sale. Check the kitchen queue, POS tender, daily reserved/sold quantities, finished-stock movements, and receipt output.
6. Keep paid cancellation blocked until a refund ledger and stock restoration policy are implemented. Chicken/goat skewers or samosas need separate product names and prices; they cannot be sold as beef.
