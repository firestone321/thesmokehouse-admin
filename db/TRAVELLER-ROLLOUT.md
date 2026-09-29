# Traveller foods in the ordinary POS

The four traveller food products are POS-only menu items. Staff add them to the same POS basket as regular products and drinks, take payment, and handle the order in the existing kitchen and Orders flow. There is no separate traveller ordering page or traveller-specific preorder form. For a call-ahead request, staff record the sale and take payment in the ordinary POS only when the traveller arrives; a caller who does not show creates no sale or stock hold. Regular juice, water, and Soda remain their ordinary menu products with shared stock.

## Database state

- `TRAVELLER-APPLY-ONCE.sql` (phases 87-97) and `phase-98-traveller-nonblocking-accompaniments.sql` were applied to the live database. Do not rerun them. Phase 89 contains a one-time conversion of shared fries stock from 225 g units to 25 g units.
- Phase 98 makes salad and sauce nonblocking. Chicken meals still require one shared chicken quarter and 200 g of shared fries; goat meals also require a dedicated 250 g goat portion. Beef skewers and samosas deduct two and three counted pieces respectively.
- At the 2026-09-29 read-only snapshot, the POS menu reported 303 sellable traveller chicken meals. This is a stock snapshot, not a tested sale.
- `phase-99-traveller-standard-pos-accompaniments.sql` is the one-file follow-up for ordinary POS sales. Apply it once after Phase 98. It counts any recorded salad and sauce servings when the normal POS reserves the order, without making missing accompaniments block the sale.
- The earlier migration created traveller preorder tables and functions. They remain in the database for schema history, but the separate admin page and API routes have been removed. Staff use the established ordering process for preorders.

## Restocking and sale checks

1. Restock shared fries, chicken quarters, and regular drinks through their existing paths. Allocate 250 g goat output when processing goat. Count actual skewers, samosas, salad servings, sauce servings, and soda bottles through the procurement tools. Salad and sauce counts do not gate a traveller sale.
2. Confirm the four traveller foods appear in the ordinary POS and remain absent from the storefront. Regular drinks can be added to the same basket.
3. After Phase 99, make one controlled ordinary POS sale with a traveller chicken meal and a regular drink. Check the receipt, kitchen order, chicken-quarter and fries deductions, and the recorded salad/sauce consumption when those servings were in stock. Check order completion and stock reconciliation.
4. Verify goat, beef skewer, and beef samosa sales after those finished portions have been counted. Chicken and goat skewers or samosas need separately named products and prices; they cannot be sold as beef.
