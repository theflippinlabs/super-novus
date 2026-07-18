-- SUPER NOVUS — Big Bang revenue tracking (dynamic Monthly Prize Pool).
-- Records every Big Bang purchase so the live Monthly Prize Pool (guaranteed $50
-- in CRO + 30% Community Bonus) can be computed and displayed. Rows are inserted
-- ONLY by the record-bigbang Edge Function (service role), after verifying the
-- payment on-chain against the Cronos RPC — so nobody can inflate the pool.
-- Public read = transparency (anyone can audit the month's revenue).

create table if not exists public.sn_bigbang_purchases (
  id            bigint generated always as identity primary key,
  wallet        text not null,                 -- buyer
  amount_cro    numeric(20,6) not null check (amount_cro > 0),
  tx_hash       text not null unique,          -- on-chain payment (idempotency key)
  period_month  date not null,                 -- first day of the purchase month (UTC)
  created_at    timestamptz not null default now()
);
alter table public.sn_bigbang_purchases enable row level security;

-- Public read only; writes go through the service-role Edge Function.
drop policy if exists "read bigbang purchases" on public.sn_bigbang_purchases;
create policy "read bigbang purchases" on public.sn_bigbang_purchases for select using (true);

create index if not exists sn_bigbang_purchases_month_idx
  on public.sn_bigbang_purchases (period_month);

-- Live total Big Bang CRO revenue for a month, callable from the anon client via
-- RPC (security definer so it reads through RLS as the owner). 30% of this is the
-- Community Bonus added to the monthly prize.
create or replace function public.sn_monthly_bigbang_revenue(p_month date)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount_cro), 0)::numeric
  from public.sn_bigbang_purchases
  where period_month = p_month;
$$;

grant execute on function public.sn_monthly_bigbang_revenue(date) to anon, authenticated;
