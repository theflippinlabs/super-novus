-- SUPER NOVUS — free Big Bang grants (promo / ops).
-- Lets the owner gift Big Bang credits to any wallet (e.g. a promo: "I give a
-- Big Bang to @someone"). The recipient's app reads its grants on connect and
-- adds any not-yet-applied credits to its local balance. Rows are written ONLY by
-- the grant-bigbang Edge Function (service role, protected by an admin secret).

create table if not exists public.sn_bigbang_grants (
  id          bigint generated always as identity primary key,
  wallet      text not null,                       -- recipient
  credits     integer not null check (credits > 0 and credits <= 90),
  note        text,                                -- optional reason (promo name…)
  created_at  timestamptz not null default now()
);
alter table public.sn_bigbang_grants enable row level security;

-- Public read: a client reads the grants addressed to its own wallet. Not
-- sensitive (it only reveals who received free credits, like a public promo list).
drop policy if exists "read grants" on public.sn_bigbang_grants;
create policy "read grants" on public.sn_bigbang_grants for select using (true);
-- No public write — inserts go through the service-role Edge Function only.

create index if not exists sn_bigbang_grants_wallet_idx
  on public.sn_bigbang_grants (lower(wallet), id);
