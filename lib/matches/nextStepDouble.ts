import { supabaseServer } from "@/lib/supabaseServer";
import { propagateFromMatch } from "@/lib/matches/propagate";

type Bracket = "winners" | "losers" | "grand_final";

type PendingMatch = {
  id: string;
  bracket: Bracket;
  round_no: number;
  match_no: number;
  status: string;
  team_a_id: string | null;
  team_b_id: string | null;
  is_reset_match: boolean | null;
  src_a_match_id: string | null;
  src_a_outcome: "winner" | "loser" | null;
  src_b_match_id: string | null;
  src_b_outcome: "winner" | "loser" | null;
};

type GfMatch = {
  id?: string;
  winner_team_id: string | null;
  status: string;
  team_a_id: string | null;
  team_b_id: string | null;
};

function pickByeWinner(match: PendingMatch): string | null {
  const hasA = Boolean(match.team_a_id);
  const hasB = Boolean(match.team_b_id);
  if (hasA === hasB) return null;
  return match.team_a_id ?? match.team_b_id;
}

type SourceMatch = {
  id: string;
  status: string;
  winner_team_id: string | null;
  team_a_id: string | null;
  team_b_id: string | null;
};

function sourceCanStillProvide(
  source: SourceMatch | null,
  outcome: "winner" | "loser" | null
): boolean {
  if (!source) return false;
  if (source.status !== "finished") return true;
  if (outcome === "winner") return !source.winner_team_id;
  if (outcome === "loser") {
    if (!source.team_a_id || !source.team_b_id) return false;
    return true;
  }
  return false;
}

async function autoAdvanceByesOnce(tournamentId: string): Promise<number> {
  const { data, error } = await supabaseServer
    .from("tournament_matches")
    .select(
      "id,bracket,round_no,match_no,status,team_a_id,team_b_id,is_reset_match,src_a_match_id,src_a_outcome,src_b_match_id,src_b_outcome"
    )
    .eq("tournament_id", tournamentId)
    .eq("status", "pending")
    .order("bracket", { ascending: true })
    .order("round_no", { ascending: true })
    .order("match_no", { ascending: true });

  if (error) throw new Error(error.message);

  let advanced = 0;
  const matches = (data ?? []) as PendingMatch[];

  const neededSources = new Set<string>();
  for (const match of matches) {
    const missingA = !match.team_a_id;
    const missingB = !match.team_b_id;
    if (missingA && match.src_a_match_id) neededSources.add(match.src_a_match_id);
    if (missingB && match.src_b_match_id) neededSources.add(match.src_b_match_id);
  }

  const sourceMap = new Map<string, SourceMatch>();
  if (neededSources.size > 0) {
    const { data: sources, error: sErr } = await supabaseServer
      .from("tournament_matches")
      .select("id,status,winner_team_id,team_a_id,team_b_id")
      .in("id", Array.from(neededSources));

    if (sErr) throw new Error(sErr.message);
    for (const s of sources ?? []) {
      const id = String(s.id ?? "");
      if (!id) continue;
      sourceMap.set(id, {
        id,
        status: String(s.status ?? "pending"),
        winner_team_id: typeof s.winner_team_id === "string" ? s.winner_team_id : null,
        team_a_id: typeof s.team_a_id === "string" ? s.team_a_id : null,
        team_b_id: typeof s.team_b_id === "string" ? s.team_b_id : null,
      });
    }
  }

  for (const match of matches) {
    if (match.is_reset_match) continue;

    if (!match.team_a_id && sourceCanStillProvide(sourceMap.get(match.src_a_match_id ?? "") ?? null, match.src_a_outcome)) {
      continue;
    }
    if (!match.team_b_id && sourceCanStillProvide(sourceMap.get(match.src_b_match_id ?? "") ?? null, match.src_b_outcome)) {
      continue;
    }

    const winner = pickByeWinner(match);
    if (!winner) continue;

    const winnerIsA = winner === match.team_a_id;

    const { error: upErr } = await supabaseServer
      .from("tournament_matches")
      .update({
        score_a: winnerIsA ? 1 : 0,
        score_b: winnerIsA ? 0 : 1,
        status: "finished",
        winner_team_id: winner,
        updated_at: new Date().toISOString(),
      })
      .eq("id", match.id)
      .eq("status", "pending");

    if (upErr) throw new Error(upErr.message);

    await propagateFromMatch(tournamentId, match.id);
    advanced++;
  }

  return advanced;
}

async function detectChampion(
  tournamentId: string,
  gfResetEnabled: boolean
): Promise<string | null> {
  const { data: result, error: resultErr } = await supabaseServer
    .from("tournament_results")
    .select("team_id")
    .eq("tournament_id", tournamentId)
    .eq("placement", 1)
    .maybeSingle();

  if (resultErr) throw new Error(resultErr.message);
  if (result?.team_id) return String(result.team_id);

  const { data: gf1, error: gf1Err } = await supabaseServer
    .from("tournament_matches")
    .select("winner_team_id,status,team_a_id,team_b_id")
    .eq("tournament_id", tournamentId)
    .eq("bracket", "grand_final")
    .eq("round_no", 1)
    .maybeSingle();

  if (gf1Err) throw new Error(gf1Err.message);

  if (!gfResetEnabled) {
    const m = gf1 as GfMatch | null;
    if (m?.status === "finished" && m.winner_team_id && m.team_a_id && m.team_b_id) return m.winner_team_id;
    return null;
  }

  const { data: gf2, error: gf2Err } = await supabaseServer
    .from("tournament_matches")
    .select("winner_team_id,status,team_a_id,team_b_id")
    .eq("tournament_id", tournamentId)
    .eq("bracket", "grand_final")
    .eq("round_no", 2)
    .maybeSingle();

  if (gf2Err) throw new Error(gf2Err.message);

  const gf2m = gf2 as GfMatch | null;
  if (gf2m?.status === "finished" && gf2m.winner_team_id && gf2m.team_a_id && gf2m.team_b_id) return gf2m.winner_team_id;

  const gf1m = gf1 as GfMatch | null;
  if (
    gf1m?.status === "finished" &&
    gf1m.winner_team_id &&
    gf1m.team_a_id &&
    gf1m.team_b_id &&
    gf1m.winner_team_id === gf1m.team_a_id
  ) {
    return gf1m.winner_team_id;
  }

  return null;
}

async function fixGrandFinalEntrantsIfMissing(tournamentId: string): Promise<boolean> {
  const { data: gf1, error: gfErr } = await supabaseServer
    .from("tournament_matches")
    .select("id,status,team_a_id,team_b_id,winner_team_id")
    .eq("tournament_id", tournamentId)
    .eq("bracket", "grand_final")
    .eq("round_no", 1)
    .maybeSingle();

  if (gfErr) throw new Error(gfErr.message);
  if (!gf1 || gf1.team_b_id) return false;

  const { data: wbFinal, error: wbErr } = await supabaseServer
    .from("tournament_matches")
    .select("winner_team_id,status,round_no")
    .eq("tournament_id", tournamentId)
    .eq("bracket", "winners")
    .order("round_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (wbErr) throw new Error(wbErr.message);

  const { data: lbLast, error: lbErr } = await supabaseServer
    .from("tournament_matches")
    .select("winner_team_id,status,round_no")
    .eq("tournament_id", tournamentId)
    .eq("bracket", "losers")
    .order("round_no", { ascending: false })
    .order("match_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lbErr) throw new Error(lbErr.message);

  const wbWinner = wbFinal?.status === "finished" ? wbFinal.winner_team_id : null;
  const lbWinner = lbLast?.status === "finished" ? lbLast.winner_team_id : null;
  if (!wbWinner || !lbWinner) return false;

  const { error: upErr } = await supabaseServer
    .from("tournament_matches")
    .update({
      team_a_id: wbWinner,
      team_b_id: lbWinner,
      score_a: 0,
      score_b: 0,
      status: "pending",
      winner_team_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", gf1.id);

  if (upErr) throw new Error(upErr.message);
  return true;
}

export async function nextStepDoubleElim(tournamentId: string) {
  const { data: t, error: tErr } = await supabaseServer
    .from("tournaments")
    .select("format,gf_reset_enabled")
    .eq("id", tournamentId)
    .single();

  if (tErr) throw new Error(tErr.message);
  if (t.format !== "double_elim") return { ok: false, error: "not_double_elim" };

  let autoAdvanced = 0;
  let repairedGrandFinal = false;
  for (let i = 0; i < 32; i++) {
    if (!repairedGrandFinal) {
      repairedGrandFinal = await fixGrandFinalEntrantsIfMissing(tournamentId);
    }
    const changed = await autoAdvanceByesOnce(tournamentId);
    autoAdvanced += changed;
    if (changed === 0) break;
  }

  const championTeamId = await detectChampion(tournamentId, Boolean(t.gf_reset_enabled));

  return {
    ok: true,
    step: autoAdvanced > 0 ? "auto_advance_byes" : repairedGrandFinal ? "repaired_grand_final" : "no_auto_byes",
    autoAdvanced,
    repairedGrandFinal,
    done: Boolean(championTeamId),
    championTeamId: championTeamId ?? null,
  };
}
