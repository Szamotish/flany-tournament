import { supabaseServer } from "@/lib/supabaseServer";

type Outcome = "winner" | "loser";

function otherTeam(teamA: string, teamB: string, winner: string) {
  return winner === teamA ? teamB : teamA;
}

export async function propagateFromMatch(tournamentId: string, matchId: string) {
  const { data: src, error: srcErr } = await supabaseServer
    .from("tournament_matches")
    .select("id,tournament_id,status,winner_team_id,team_a_id,team_b_id,bracket,is_reset_match")
    .eq("id", matchId)
    .single();

  if (srcErr) throw new Error(srcErr.message);
  if (src.tournament_id !== tournamentId) throw new Error("match_not_in_tournament");
  if (src.status !== "finished" || !src.winner_team_id) return { ok: true, updated: 0 };

  if (!src.team_a_id || !src.team_b_id) return { ok: true, updated: 0 };

  const winnerId = src.winner_team_id as string;
  const loserId = otherTeam(src.team_a_id, src.team_b_id, winnerId);

  const { data: t, error: tErr } = await supabaseServer
    .from("tournaments")
    .select("id,format,gf_reset_enabled")
    .eq("id", tournamentId)
    .single();

  if (tErr) throw new Error(tErr.message);

  const { data: deps, error: depsErr } = await supabaseServer
    .from("tournament_matches")
    .select(
      "id,bracket,is_reset_match,team_a_id,team_b_id,src_a_match_id,src_a_outcome,src_b_match_id,src_b_outcome,status,winner_team_id"
    )
    .eq("tournament_id", tournamentId)
    .or(`src_a_match_id.eq.${matchId},src_b_match_id.eq.${matchId}`);

  if (depsErr) throw new Error(depsErr.message);

  let updatedCount = 0;

  for (const m of deps ?? []) {
    if (m.is_reset_match) {
      if (!t.gf_reset_enabled) continue;

      if (m.src_a_match_id === matchId || m.src_b_match_id === matchId) {
        const { data: gf, error: gfErr } = await supabaseServer
          .from("tournament_matches")
          .select("id,bracket,team_a_id,team_b_id,winner_team_id,status")
          .eq("id", matchId)
          .single();

        if (gfErr) throw new Error(gfErr.message);

        if (gf.bracket !== "grand_final") continue;
        if (gf.status !== "finished" || !gf.winner_team_id) continue;

        if (gf.team_a_id && gf.winner_team_id === gf.team_a_id) {
          continue;
        }
      }
    }

    const patch: Partial<{
      team_a_id: string;
      team_b_id: string;
      score_a: number;
      score_b: number;
      winner_team_id: null;
      status: "pending";
      updated_at: string;
    }> = {};
    let touched = false;

    if (m.src_a_match_id === matchId && (m.src_a_outcome === "winner" || m.src_a_outcome === "loser")) {
      const team = (m.src_a_outcome as Outcome) === "winner" ? winnerId : loserId;
      if (m.team_a_id !== team) {
        patch.team_a_id = team;
        touched = true;
      }
    }

    if (m.src_b_match_id === matchId && (m.src_b_outcome === "winner" || m.src_b_outcome === "loser")) {
      const team = (m.src_b_outcome as Outcome) === "winner" ? winnerId : loserId;
      if (m.team_b_id !== team) {
        patch.team_b_id = team;
        touched = true;
      }
    }

    if (!touched) continue;

    patch.score_a = 0;
    patch.score_b = 0;
    patch.winner_team_id = null;

    patch.status = patch.team_a_id && (m.team_b_id || patch.team_b_id) ? "pending" : "pending";
    patch.updated_at = new Date().toISOString();

    const { error: upErr } = await supabaseServer
      .from("tournament_matches")
      .update(patch)
      .eq("id", m.id);

    if (upErr) throw new Error(upErr.message);
    updatedCount++;
  }

  return { ok: true, updated: updatedCount };
}
