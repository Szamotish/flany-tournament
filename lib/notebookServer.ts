import { supabaseServer } from "./supabaseServer";
import type { NotebookPlayer, NotebookTeam } from "./notebook";

export type NotebookMatch = {
  id: string; bo: number; round_no: number; match_no: number; bracket: string; status: string;
  team_a_id: string | null; team_b_id: string | null;
};
export class NotebookError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

export async function readNotebookCatalog(tournamentId: string, matchId?: string) {
  const { data: tournament, error: tErr } = await supabaseServer.from("tournaments").select("id,mode").eq("id", tournamentId).maybeSingle();
  if (tErr) throw new NotebookError("notebook_read_failed", 500);
  if (!tournament) throw new NotebookError("tournament_not_found", 404);
  if (tournament.mode !== "ranked") throw new NotebookError("ranked_only", 400);
  let query = supabaseServer.from("tournament_matches")
    .select("id,bo,round_no,match_no,bracket,status,team_a_id,team_b_id").eq("tournament_id", tournamentId);
  if (matchId) query = query.eq("id", matchId);
  const { data, error } = await query.order("round_no").order("match_no").order("id").limit(501);
  if (error || !data || data.length > 500) throw new NotebookError("notebook_read_failed", 500);
  const matches = data as NotebookMatch[];
  const teamIds = [...new Set(matches.flatMap(m => [m.team_a_id, m.team_b_id].filter((id): id is string => !!id)))];
  if (!teamIds.length) return { matches, teams: [] as NotebookTeam[], players: [] as NotebookPlayer[] };
  const [teams, members] = await Promise.all([
    supabaseServer.from("teams").select("id,name").in("id", teamIds).limit(1000),
    supabaseServer.from("team_members").select("team_id,player_id,players(name)").in("team_id", teamIds).limit(1000),
  ]);
  if (teams.error || members.error || !teams.data || !members.data || members.data.length >= 1000) throw new NotebookError("notebook_read_failed", 500);
  const players = members.data.map(m => {
    const relation = m.players as unknown as { name: string } | { name: string }[] | null;
    const player = Array.isArray(relation) ? relation[0] : relation;
    return { id: String(m.player_id), name: player?.name ?? "Zawodnik", teamId: String(m.team_id) };
  }).sort((a, b) => a.name.localeCompare(b.name, "pl"));
  return { matches, teams: teams.data as NotebookTeam[], players };
}

export function rosterForMatch(catalog: Awaited<ReturnType<typeof readNotebookCatalog>>, matchId: string, game: number) {
  const match = catalog.matches.find(m => m.id === matchId);
  if (!match) throw new NotebookError("match_not_in_tournament", 404);
  if (!match.team_a_id || !match.team_b_id || match.team_a_id === match.team_b_id) throw new NotebookError("match_not_ready", 400);
  if (!Number.isInteger(game) || game < 1 || game > match.bo || game > 9) throw new NotebookError("invalid_game", 400);
  const roster = catalog.players.filter(p => p.teamId === match.team_a_id || p.teamId === match.team_b_id);
  if (!roster.some(p => p.teamId === match.team_a_id) || !roster.some(p => p.teamId === match.team_b_id) ||
    roster.length > 40 || new Set(roster.map(p => p.id)).size !== roster.length) throw new NotebookError("invalid_roster", 400);
  return roster;
}

export function sameNotebookRoster(a: NotebookPlayer[], b: NotebookPlayer[]) {
  return a.length === b.length && a.every(p => b.some(other => p.id === other.id && p.teamId === other.teamId));
}

export function notebookStorageError(error: { code?: string }) {
  return new NotebookError(["42P01", "PGRST205"].includes(error.code ?? "") ? "missing_notebook_schema" : "notebook_storage_failed", 503);
}
