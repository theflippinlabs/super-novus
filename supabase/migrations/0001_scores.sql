-- SUPER NOVUS — leaderboard schema
-- Apply with: supabase db push   (or paste in the Supabase SQL editor)

create table if not exists public.sn_scores (
  wallet      text primary key,
  best_score  integer not null check (best_score >= 0),
  best_dist   integer not null default 0,
  best_dust   integer not null default 0,
  updated_at  timestamptz not null default now()
);
alter table public.sn_scores enable row level security;

-- Public read of the leaderboard
drop policy if exists "read scores" on public.sn_scores;
create policy "read scores" on public.sn_scores for select using (true);
-- No insert/update policy: writes happen only via Edge Function (service role).

create index if not exists sn_scores_best_idx on public.sn_scores (best_score desc);

-- Dedicated table for rate limiting (sn_scores.updated_at only changes on a new record)
create table if not exists public.sn_score_submissions (
  id           bigint generated always as identity primary key,
  wallet       text not null,
  submitted_at timestamptz not null default now()
);
create index if not exists sn_score_submissions_wallet_time_idx
  on public.sn_score_submissions (wallet, submitted_at desc);
alter table public.sn_score_submissions enable row level security;
-- No public policy: service role only.
