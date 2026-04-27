-- Account auth + roles + tournament admin model
-- Run in Supabase SQL Editor (project database).

alter table public.players
  add column if not exists auth_user_id uuid;

do $$
begin
  alter table public.players
    add constraint players_auth_user_id_fkey
    foreign key (auth_user_id)
    references auth.users(id)
    on delete set null;
exception
  when duplicate_object then null;
end
$$;

create unique index if not exists players_auth_user_id_unique
  on public.players(auth_user_id)
  where auth_user_id is not null;

alter table public.players
  add column if not exists is_main_admin boolean not null default false;

alter table public.players
  add column if not exists rank_frame_enabled boolean not null default true;

create table if not exists public.tournament_admins (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tournament_id, player_id)
);

create index if not exists tournament_admins_player_idx
  on public.tournament_admins(player_id);

alter table public.ratings
  add column if not exists rater_player_id uuid;

do $$
begin
  alter table public.ratings
    add constraint ratings_rater_player_id_fkey
    foreign key (rater_player_id)
    references public.players(id)
    on delete cascade;
exception
  when duplicate_object then null;
end
$$;

delete from public.ratings
where rater_player_id is null;

alter table public.ratings
  alter column rater_player_id set not null;

do $$
begin
  alter table public.ratings
    add constraint ratings_rater_player_id_rated_player_id_key
    unique (rater_player_id, rated_player_id);
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournaments'
      and column_name = 'local_admin_password'
  ) then
    alter table public.tournaments
      alter column local_admin_password drop not null;
  end if;
end
$$;
