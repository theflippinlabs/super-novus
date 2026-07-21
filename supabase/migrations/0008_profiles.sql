-- SUPER NOVUS — shared player profiles (nickname + avatar), so a pseudo a player
-- sets is the SAME everywhere in the game, for everyone (leaderboard, podium,
-- admin) — not just on their own device.
-- Public read (identities are shown publicly on the board). Writes go through the
-- set-profile Edge Function (service role). Nicknames are unique (case-insensitive).

create table if not exists public.sn_profiles (
  wallet      text primary key,          -- lowercased
  nickname    text,
  avatar_url  text,
  updated_at  timestamptz not null default now()
);
alter table public.sn_profiles enable row level security;

drop policy if exists "read profiles" on public.sn_profiles;
create policy "read profiles" on public.sn_profiles for select using (true);

-- One nickname per player (case-insensitive), ignoring rows with no nickname.
create unique index if not exists sn_profiles_nick_uidx
  on public.sn_profiles (lower(nickname)) where nickname is not null;
