import { supabaseServer } from "@/lib/supabaseServer";

type RoundMatch = {
  id: string;
  status: string;
  winner_team_id: string | null;
  team_a_id: string | null;
  team_b_id: string | null;
};

function pairUp(ids: string[]) {
  const pairs: { a: string; b: string | null }[] = [];
  for (let i = 0; i < ids.length; i += 2) {
    pairs.push({ a: ids[i], b: ids[i + 1] ?? null });
  }
  return pairs;
}

export async function autoAdvanceSingleElim(tournamentId: string) {
  const { data: t, error: tErr } = await supabaseServer
    .from("tournaments")
    .select("id,format,bo_default,bo_finals")
    .eq("id", tournamentId)
    .single();

  if (tErr) throw new Error(tErr.message);
  if (t.format !== "single_elim") return { createdRounds: 0, done: false, championTeamId: null as string | null };

  let createdRounds = 0;

  for (let i = 0; i < 32; i++) {
    const { data: last, error: lastErr } = await supabaseServer
      .from("tournament_matches")
      .select("round_no")
      .eq("tournament_id", tournamentId)
      .eq("bracket", "single")
      .order("round_no", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastErr) throw new Error(lastErr.message);
    if (!last) return { createdRounds, done: false, championTeamId: null as string | null };

    const currentRound = Number(last.round_no ?? 0);

    const { data: matches, error: mErr } = await supabaseServer
      .from("tournament_matches")
      .select("id,status,winner_team_id,team_a_id,team_b_id")
      .eq("tournament_id", tournamentId)
      .eq("bracket", "single")
      .eq("round_no", currentRound)
      .order("match_no", { ascending: true });

    if (mErr) throw new Error(mErr.message);
    const roundMatches = (matches ?? []) as RoundMatch[];
    if (roundMatches.length === 0) return { createdRounds, done: false, championTeamId: null as string | null };

    const notFinished = roundMatches.some((m) => m.status !== "finished");
    if (notFinished) return { createdRounds, done: false, championTeamId: null as string | null };

    const winners = roundMatches.map((m) => m.winner_team_id).filter(Boolean) as string[];
    if (winners.length < 2) {
      return { createdRounds, done: true, championTeamId: winners[0] ?? null };
    }

    const nextRound = currentRound + 1;

    const { count: existsCount, error: eErr } = await supabaseServer
      .from("tournament_matches")
      .select("*", { count: "exact", head: true })
      .eq("tournament_id", tournamentId)
      .eq("bracket", "single")
      .eq("round_no", nextRound);

    if (eErr) throw new Error(eErr.message);
    if ((existsCount ?? 0) > 0) return { createdRounds, done: false, championTeamId: null as string | null };

    const pairs = pairUp(winners);
    const isFinal = pairs.length === 1;

    const inserts = pairs.map((p, idx) => {
      const isBye = !p.b;
      return {
        tournament_id: tournamentId,
        bracket: "single" as const,
        round_no: nextRound,
        match_no: idx + 1,
        team_a_id: p.a,
        team_b_id: p.b,
        bo: isFinal ? t.bo_finals : t.bo_default,
        score_a: isBye ? 1 : 0,
        score_b: 0,
        status: isBye ? ("finished" as const) : ("pending" as const),
        winner_team_id: isBye ? p.a : null,
      };
    });

    const { error: insErr } = await supabaseServer.from("tournament_matches").insert(inserts);
    if (insErr) throw new Error(insErr.message);

    createdRounds++;
  }

  return { createdRounds, done: false, championTeamId: null as string | null };
}
