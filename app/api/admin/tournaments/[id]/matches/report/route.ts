import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { assertTournamentAdmin } from "@/app/api/admin/tournaments/_auth";
import { propagateFromMatch } from "@/lib/matches/propagate";
import { autoAdvanceSingleElim } from "@/lib/matches/autoAdvanceSingle";
import { nextStepDoubleElim } from "@/lib/matches/nextStepDouble";
import {
  applyRankedDelta,
  normalizeMode,
  RANKED_MATCH_LOSS_DELTA,
  RANKED_MATCH_WIN_DELTA,
  RANKED_TOURNAMENT_WIN_BONUS,
} from "@/lib/ranked";
import { loadPlayerPerformance } from "@/lib/playerPerformance";

async function mapTeamPlayers(teamIds: string[]): Promise<Map<string, string[]>> {
  const uniqueTeamIds = Array.from(new Set(teamIds.filter(Boolean)));
  const result = new Map<string, string[]>();

  if (uniqueTeamIds.length === 0) return result;

  const { data: members, error } = await supabaseServer
    .from("team_members")
    .select("team_id,player_id")
    .in("team_id", uniqueTeamIds);

  if (error) throw new Error(`ranked_team_members_failed: ${error.message}`);

  for (const row of members ?? []) {
    const teamId = String(row.team_id ?? "");
    const playerId = String(row.player_id ?? "");
    if (!teamId || !playerId) continue;
    const current = result.get(teamId) ?? [];
    current.push(playerId);
    result.set(teamId, current);
  }

  return result;
}

async function applyDeltaToPlayers(
  playerIds: string[],
  delta: number,
  options?: {
    excludeMatchId?: string;
    reason?: "match_win" | "match_loss" | "tournament_win";
    tournamentId?: string;
    matchId?: string;
  }
): Promise<void> {
  const uniquePlayerIds = Array.from(new Set(playerIds.filter(Boolean)));
  if (uniquePlayerIds.length === 0) return;

  const perfByPlayer = await loadPlayerPerformance(uniquePlayerIds, {
    excludeMatchId: options?.excludeMatchId,
  });

  const updates = uniquePlayerIds.map((playerId) => {
    const perf = perfByPlayer.get(playerId);
    if (!perf) {
      return {
        id: playerId,
        mmr: 0,
        prestige_points: 0,
      };
    }
    const state = {
      mmr: perf.effectiveMmr,
      prestigePoints: perf.prestigePoints,
    };
    const next = applyRankedDelta(state, delta);
    return {
      id: playerId,
      mmr: next.mmr,
      prestige_points: next.prestigePoints,
    };
  });

  if (updates.length === 0) return;

  const { error: updateErr } = await supabaseServer.from("players").upsert(updates, {
    onConflict: "id",
  });

  if (updateErr) throw new Error(`ranked_players_update_failed: ${updateErr.message}`);

  const historyRows = updates.map((row) => ({
    player_id: row.id,
    tournament_id: options?.tournamentId ?? null,
    match_id: options?.matchId ?? null,
    reason: options?.reason ?? "manual",
    delta,
    mmr: row.mmr,
    prestige_points: row.prestige_points,
  }));

  const historyInsert = await supabaseServer.from("player_mmr_history").insert(historyRows);
  if (historyInsert.error && !historyInsert.error.message.includes("player_mmr_history")) {
    throw new Error(`ranked_history_insert_failed: ${historyInsert.error.message}`);
  }
}

async function applyDeltaToTeams(
  teamIds: string[],
  delta: number,
  options?: {
    excludeMatchId?: string;
    reason?: "match_win" | "match_loss" | "tournament_win";
    tournamentId?: string;
    matchId?: string;
  }
): Promise<void> {
  const teamPlayersMap = await mapTeamPlayers(teamIds);
  const playerIds = Array.from(teamPlayersMap.values()).flat();
  await applyDeltaToPlayers(playerIds, delta, options);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tournamentId } = await params;

  const auth = await assertTournamentAdmin(req, tournamentId);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });
  }

  const body = await req.json().catch(() => null);
  const matchId = String(body?.matchId ?? "");
  const scoreA = Number(body?.scoreA);
  const scoreB = Number(body?.scoreB);

  if (!matchId) return NextResponse.json({ error: "missing_matchId" }, { status: 400 });
  if (!Number.isInteger(scoreA) || scoreA < 0 || scoreA > 5) {
    return NextResponse.json({ error: "invalid_scoreA" }, { status: 400 });
  }
  if (!Number.isInteger(scoreB) || scoreB < 0 || scoreB > 5) {
    return NextResponse.json({ error: "invalid_scoreB" }, { status: 400 });
  }

  const { data: m, error: mErr } = await supabaseServer
    .from("tournament_matches")
    .select("id,tournament_id,bo,team_a_id,team_b_id,status,winner_team_id")
    .eq("id", matchId)
    .single();

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
  if (m.tournament_id !== tournamentId) {
    return NextResponse.json({ error: "match_not_in_tournament" }, { status: 403 });
  }
  if (!m.team_a_id || !m.team_b_id) {
    return NextResponse.json({ error: "cannot_report_bye_match" }, { status: 400 });
  }

  const need = Math.floor(Number(m.bo) / 2) + 1;
  const wasFinishedBefore = m.status === "finished" && typeof m.winner_team_id === "string" && m.winner_team_id.length > 0;
  const finished = scoreA >= need || scoreB >= need;

  let winner: string | null = null;
  if (finished) {
    if (scoreA === scoreB) {
      return NextResponse.json({ error: "tie_not_allowed" }, { status: 400 });
    }
    winner = scoreA > scoreB ? m.team_a_id : m.team_b_id;
  }

  const { data: updated, error: uErr } = await supabaseServer
    .from("tournament_matches")
    .update({
      score_a: scoreA,
      score_b: scoreB,
      status: finished ? "finished" : "pending",
      winner_team_id: winner,
      updated_at: new Date().toISOString(),
    })
    .eq("id", matchId)
    .select("id,score_a,score_b,status,winner_team_id,bo")
    .single();

  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  if (updated.status === "finished" && updated.winner_team_id) {
    try {
      await propagateFromMatch(tournamentId, matchId);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: `propagate_failed: ${message}` },
        { status: 500 }
      );
    }
  }

  try {
    const { data: t, error: tErr } = await supabaseServer
      .from("tournaments")
      .select("id,format,gf_reset_enabled,mode")
      .eq("id", tournamentId)
      .single();

    if (tErr) throw new Error(tErr.message);
    const tournamentMode = normalizeMode((t as { mode?: unknown }).mode);

    if (
      tournamentMode === "ranked" &&
      updated.status === "finished" &&
      updated.winner_team_id &&
      !wasFinishedBefore
    ) {
      const winnerTeamId = String(updated.winner_team_id);
      const loserTeamId = winnerTeamId === m.team_a_id ? m.team_b_id : m.team_a_id;
      await applyDeltaToTeams([winnerTeamId], RANKED_MATCH_WIN_DELTA, {
        excludeMatchId: matchId,
        reason: "match_win",
        tournamentId,
        matchId,
      });
      if (loserTeamId) {
        await applyDeltaToTeams([loserTeamId], RANKED_MATCH_LOSS_DELTA, {
          excludeMatchId: matchId,
          reason: "match_loss",
          tournamentId,
          matchId,
        });
      }
    }

    if (updated.status === "finished" && updated.winner_team_id) {
      if (t.format === "single_elim") {
        await autoAdvanceSingleElim(tournamentId);
      } else if (t.format === "double_elim") {
        await nextStepDoubleElim(tournamentId);
      }
    }

    async function saveResults(championId: string, runnerUpId: string) {
      const { data: existingChampion, error: existingErr } = await supabaseServer
        .from("tournament_results")
        .select("team_id")
        .eq("tournament_id", tournamentId)
        .eq("placement", 1)
        .maybeSingle();

      if (existingErr) throw new Error(existingErr.message);
      const hadChampionBefore = Boolean(existingChampion?.team_id);

      const { error: delErr } = await supabaseServer
        .from("tournament_results")
        .delete()
        .eq("tournament_id", tournamentId)
        .in("placement", [1, 2]);

      if (delErr) throw new Error(delErr.message);

      const { error: insErr } = await supabaseServer
        .from("tournament_results")
        .insert([
          { tournament_id: tournamentId, team_id: championId, placement: 1 },
          { tournament_id: tournamentId, team_id: runnerUpId, placement: 2 },
        ]);

      if (insErr) throw new Error(insErr.message);

      if (tournamentMode === "ranked" && !hadChampionBefore) {
        await applyDeltaToTeams([championId], RANKED_TOURNAMENT_WIN_BONUS, {
          reason: "tournament_win",
          tournamentId,
        });
      }
    }

    if (t.format === "single_elim") {
      const { data: lastRoundRow, error: roundErr } = await supabaseServer
        .from("tournament_matches")
        .select("round_no")
        .eq("tournament_id", tournamentId)
        .eq("bracket", "single")
        .order("round_no", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (roundErr) throw new Error(roundErr.message);

      if (lastRoundRow?.round_no) {
        const finalRound = Number(lastRoundRow.round_no);

        const { data: finalMatches, error: fmErr } = await supabaseServer
          .from("tournament_matches")
          .select("id,team_a_id,team_b_id,winner_team_id,status")
          .eq("tournament_id", tournamentId)
          .eq("bracket", "single")
          .eq("round_no", finalRound)
          .order("match_no", { ascending: true });

        if (fmErr) throw new Error(fmErr.message);

        const finals = finalMatches ?? [];
        if (
          finals.length === 1 &&
          finals[0].status === "finished" &&
          finals[0].winner_team_id &&
          finals[0].team_a_id &&
          finals[0].team_b_id
        ) {
          const championId = finals[0].winner_team_id;
          const runnerUpId = championId === finals[0].team_a_id ? finals[0].team_b_id : finals[0].team_a_id;
          await saveResults(championId, runnerUpId);
        }
      }
    }

    if (t.format === "double_elim") {
      const { data: gf2, error: gf2Err } = await supabaseServer
        .from("tournament_matches")
        .select("id,team_a_id,team_b_id,winner_team_id,status,round_no")
        .eq("tournament_id", tournamentId)
        .eq("bracket", "grand_final")
        .eq("round_no", 2)
        .maybeSingle();

      if (gf2Err) throw new Error(gf2Err.message);

      if (t.gf_reset_enabled && gf2 && gf2.status === "finished" && gf2.winner_team_id && gf2.team_a_id && gf2.team_b_id) {
        const championId = gf2.winner_team_id;
        const runnerUpId = championId === gf2.team_a_id ? gf2.team_b_id : gf2.team_a_id;
        await saveResults(championId, runnerUpId);
      } else {
        const { data: gf1, error: gf1Err } = await supabaseServer
          .from("tournament_matches")
          .select("id,team_a_id,team_b_id,winner_team_id,status,round_no")
          .eq("tournament_id", tournamentId)
          .eq("bracket", "grand_final")
          .eq("round_no", 1)
          .maybeSingle();

        if (gf1Err) throw new Error(gf1Err.message);

        if (gf1 && gf1.status === "finished" && gf1.winner_team_id && gf1.team_a_id && gf1.team_b_id) {
          const championId = gf1.winner_team_id;
          const runnerUpId = championId === gf1.team_a_id ? gf1.team_b_id : gf1.team_a_id;

          if (!t.gf_reset_enabled) {
            await saveResults(championId, runnerUpId);
          } else {
            if (championId === gf1.team_a_id) {
              const { error: removeGf2Err } = await supabaseServer
                .from("tournament_matches")
                .delete()
                .eq("tournament_id", tournamentId)
                .eq("bracket", "grand_final")
                .eq("round_no", 2)
                .eq("status", "pending");

              if (removeGf2Err) throw new Error(removeGf2Err.message);
              await saveResults(championId, runnerUpId);
            }
          }
        }
      }
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `finish_tournament_failed: ${message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ match: updated });
}
