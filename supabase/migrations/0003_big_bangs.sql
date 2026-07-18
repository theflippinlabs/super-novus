-- SUPER NOVUS — record how many Big Bang revives were used for a score.
-- Purely informational (transparency on the leaderboard); default 0 so it is
-- backward-compatible with clients/functions that don't send it yet.

alter table public.sn_leaderboard
  add column if not exists big_bangs integer not null default 0;

alter table public.sn_score_submissions
  add column if not exists big_bangs integer;
