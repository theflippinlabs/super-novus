-- SUPER NOVUS — period-based leaderboards (weekly + monthly) with archiving.
-- Apply with: supabase db push   (or paste into the Supabase SQL editor).
--
-- Design: one row per (wallet, period_type, period_start) holding that
-- wallet's best score for the period. "Reset" is implicit — a new period has
-- a new period_start (Monday 00:00 UTC for weekly, the 1st for monthly), so
-- the fresh leaderboard is simply empty. Past periods are never deleted, which
-- IS the archive: query any historical period_start to read its final ranking.

create table if not exists public.sn_leaderboard (
  id           bigint generated always as identity primary key,
  wallet       text not null,
  period_type  text not null check (period_type in ('weekly','monthly')),
  period_start date not null,   -- UTC: Monday (weekly) or 1st of month (monthly)
  best_score   integer not null default 0 check (best_score >= 0),
  best_dist    integer not null default 0,
  best_dust    integer not null default 0,
  updated_at   timestamptz not null default now(),
  unique (wallet, period_type, period_start)
);
alter table public.sn_leaderboard enable row level security;

-- Public read of every period (current + archived).
drop policy if exists "read leaderboard" on public.sn_leaderboard;
create policy "read leaderboard" on public.sn_leaderboard for select using (true);
-- No insert/update policy: writes happen only via the Edge Function (service role).

create index if not exists sn_leaderboard_rank_idx
  on public.sn_leaderboard (period_type, period_start, best_score desc);

-- Raw submission log kept for rate limiting + anti-cheat audit trail.
create table if not exists public.sn_score_submissions (
  id           bigint generated always as identity primary key,
  wallet       text not null,
  score        integer,
  dist         integer,
  dust         integer,
  submitted_at timestamptz not null default now()
);
create index if not exists sn_score_submissions_wallet_time_idx
  on public.sn_score_submissions (wallet, submitted_at desc);
alter table public.sn_score_submissions enable row level security;
-- No public policy: service role only.
