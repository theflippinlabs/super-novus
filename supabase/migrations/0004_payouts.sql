-- SUPER NOVUS — prize payout ledger + automatic winner selection.
-- SAFE MODEL: this only SELECTS winners and records them. No funds ever move
-- from here — the treasury owner approves and sends the payout from their own
-- wallet (see the admin panel + record-payout function).

create table if not exists public.sn_payouts (
  id           bigint generated always as identity primary key,
  period_type  text not null check (period_type in ('weekly','monthly')),
  period_start date not null,            -- the period that ENDED
  rank         integer not null default 1,
  wallet       text not null,            -- winner
  best_score   integer not null default 0,
  status       text not null default 'pending' check (status in ('pending','paid','skipped')),
  tx_hash      text,                     -- filled once the owner pays
  created_at   timestamptz not null default now(),
  paid_at      timestamptz,
  unique (period_type, period_start, rank)
);
alter table public.sn_payouts enable row level security;
-- Public read = transparency (anyone can audit prizes owed/paid).
drop policy if exists "read payouts" on public.sn_payouts;
create policy "read payouts" on public.sn_payouts for select using (true);
-- No public write: rows are created by the scheduled function (service role /
-- security definer) and marked paid only through the record-payout Edge Function.

create index if not exists sn_payouts_status_idx on public.sn_payouts (status, period_type, period_start desc);

-- Record the Top-1 winner of one finished period into the ledger (idempotent).
create or replace function public.sn_close_period(p_type text, p_start date)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.sn_payouts (period_type, period_start, rank, wallet, best_score)
  select p_type, p_start, 1, wallet, best_score
  from public.sn_leaderboard
  where period_type = p_type and period_start = p_start
  order by best_score desc
  limit 1
  on conflict (period_type, period_start, rank) do nothing;
end; $$;

-- Close any period that has just ended (weekly = last ISO week, monthly = last
-- month, in UTC). Idempotent — safe to run daily; catches up if a run is missed.
create or replace function public.sn_close_due_periods()
returns void language plpgsql security definer set search_path = public as $$
declare
  last_week_start  date := ((date_trunc('week',  (now() at time zone 'utc')) - interval '7 days'))::date;
  last_month_start date := ((date_trunc('month', (now() at time zone 'utc')) - interval '1 month'))::date;
begin
  perform public.sn_close_period('weekly',  last_week_start);
  perform public.sn_close_period('monthly', last_month_start);
end; $$;

-- Schedule the automatic selection. Requires the pg_cron extension:
--   (Supabase → Database → Extensions → enable "pg_cron"), or:  create extension if not exists pg_cron;
-- Runs daily at 00:15 UTC; on the first day of a new week/month it records the
-- winner of the period that just ended.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('sn-close-due') where exists (select 1 from cron.job where jobname = 'sn-close-due');
    perform cron.schedule('sn-close-due', '15 0 * * *', $cron$ select public.sn_close_due_periods(); $cron$);
  end if;
end $$;
