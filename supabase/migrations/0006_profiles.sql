-- SUPER NOVUS — player profiles + run history (identity, stats, history, rewards).
-- Players are shown as Avatar + Nickname everywhere; the address is never the
-- public identity. Nicknames are unique (case-insensitive). Avatars are stored as
-- data URIs (or null = use the generated cosmic avatar). Runs feed lifetime stats
-- and the game-history list. Public read = the leaderboard/profile can display
-- nicknames + avatars; writes go through the signed save-profile Edge Function
-- and the service-role submit-score function.

create table if not exists public.sn_profiles (
  wallet      text primary key,              -- stored lowercase
  nickname    text,
  avatar_url  text,                          -- data URI or null (generated avatar)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.sn_profiles enable row level security;
drop policy if exists "read profiles" on public.sn_profiles;
create policy "read profiles" on public.sn_profiles for select using (true);
-- Case-insensitive unique nickname (only when one is set).
create unique index if not exists sn_profiles_nickname_lower_uidx
  on public.sn_profiles (lower(nickname)) where nickname is not null;

create table if not exists public.sn_runs (
  id            bigint generated always as identity primary key,
  wallet        text not null,
  score         integer not null default 0,
  dist          integer not null default 0,
  dust          integer not null default 0,
  big_bangs     integer not null default 0,
  weekly_rank   integer,
  monthly_rank  integer,
  created_at    timestamptz not null default now()
);
alter table public.sn_runs enable row level security;
drop policy if exists "read runs" on public.sn_runs;
create policy "read runs" on public.sn_runs for select using (true);
create index if not exists sn_runs_wallet_idx on public.sn_runs (lower(wallet), created_at desc);

-- Lifetime stats for a wallet: aggregates the run history + wins from the payout
-- ledger. Returned as a single JSON object for the client.
create or replace function public.sn_profile_stats(p_wallet text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with r as (
    select * from public.sn_runs where lower(wallet) = lower(p_wallet)
  ), p as (
    select * from public.sn_payouts where lower(wallet) = lower(p_wallet) and rank = 1
  )
  select jsonb_build_object(
    'high_score',        coalesce((select max(score)     from r), 0),
    'total_dist',        coalesce((select sum(dist)      from r), 0),
    'total_dust',        coalesce((select sum(dust)      from r), 0),
    'games',             coalesce((select count(*)       from r), 0),
    'deaths',            coalesce((select count(*)       from r), 0),
    'big_bangs',         coalesce((select sum(big_bangs) from r), 0),
    'weekly_wins',       coalesce((select count(*) from p where period_type = 'weekly'), 0),
    'monthly_wins',      coalesce((select count(*) from p where period_type = 'monthly'), 0),
    'best_weekly_rank',  (select min(weekly_rank)  from r where weekly_rank  is not null),
    'best_monthly_rank', (select min(monthly_rank) from r where monthly_rank is not null)
  );
$$;
grant execute on function public.sn_profile_stats(text) to anon, authenticated;
