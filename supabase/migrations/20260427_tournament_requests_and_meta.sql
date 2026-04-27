-- Tournament join/invite flow + basic tournament metadata

alter table public.tournaments
  add column if not exists event_at timestamptz;

alter table public.tournaments
  add column if not exists event_location text;

alter table public.tournaments
  add column if not exists join_deadline_at timestamptz;

alter table public.players
  add column if not exists email_notifications_enabled boolean not null default false;

create table if not exists public.tournament_join_requests (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_player_id uuid references public.players(id) on delete set null
);

create unique index if not exists tournament_join_requests_pending_unique
  on public.tournament_join_requests(tournament_id, player_id)
  where status = 'pending';

create index if not exists tournament_join_requests_player_idx
  on public.tournament_join_requests(player_id, created_at desc);

create table if not exists public.tournament_invites (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  invited_by_player_id uuid not null references public.players(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index if not exists tournament_invites_pending_unique
  on public.tournament_invites(tournament_id, player_id)
  where status = 'pending';

create index if not exists tournament_invites_player_idx
  on public.tournament_invites(player_id, created_at desc);
