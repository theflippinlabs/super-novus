-- SUPER NOVUS — record how much CRO each prize payout actually cost, so the admin
-- console can produce a clean financial ledger (revenue in vs. prizes out).
-- The amount is captured server-side from the on-chain transaction by the
-- record-payout Edge Function, so it is authoritative and cannot be faked.

alter table public.sn_payouts
  add column if not exists amount_cro numeric(20,6);
