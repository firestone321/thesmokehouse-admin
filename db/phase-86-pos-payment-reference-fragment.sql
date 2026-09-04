-- Phase 86: Allow a full Pesapal POS terminal reference or its last four digits.
-- Cash does not require a reference. Non-cash tender references are numeric and
-- must be either the full 11 digits printed by the terminal or its last four.

begin;

alter table public.pos_tenders
  drop constraint if exists pos_tenders_non_cash_reference_chk;

alter table public.pos_tenders
  add constraint pos_tenders_non_cash_reference_chk check (
    tender_type = 'cash' or btrim(coalesce(payment_reference, '')) ~ '^(?:[0-9]{4}|[0-9]{11})$'
  );

commit;
