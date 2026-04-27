-- Optional: clean old app data before starting with account-based flow.
-- Run only if you want a fresh start.

truncate table public.tournament_admins restart identity cascade;
truncate table public.tournament_results restart identity cascade;
truncate table public.tournament_matches restart identity cascade;
truncate table public.team_members restart identity cascade;
truncate table public.teams restart identity cascade;
truncate table public.team_batches restart identity cascade;
truncate table public.tournament_players restart identity cascade;
truncate table public.tournaments restart identity cascade;
truncate table public.ratings restart identity cascade;
delete from public.players;
