import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { assertTournamentAdmin } from "@/app/api/admin/tournaments/_auth";

function pairUp(ids: string[]) {
  const pairs: { a: string; b: string | null }[] = [];
  for (let i = 0; i < ids.length; i += 2) {
    pairs.push({ a: ids[i], b: ids[i + 1] ?? null });
  }
  return pairs;
}

type RoundMatch = {
  id: string;
  status: string;
  winner_team_id: string | null;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tournamentId } = await params;

  const auth = await assertTournamentAdmin(req, tournamentId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });

    const { data: tmeta, error: tmetaErr } = await supabaseServer
    .from("tournaments")
    .select("format")
    .eq("id", tournamentId)
    .single();

  if (tmetaErr) return NextResponse.json({ error: tmetaErr.message }, { status: 500 });

  if (tmeta.format === "double_elim") {
    return NextResponse.json(
      { error: "use_double_elim_endpoint" },
      { status: 400 }
    );
  }

  const { data: t, error: tErr } = await supabaseServer
    .from("tournaments")
    .select("id, bo_default, bo_finals")
    .eq("id", tournamentId)
    .single();

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

  const { data: last, error: lastErr } = await supabaseServer
    .from("tournament_matches")
    .select("round_no")
    .eq("tournament_id", tournamentId)
    .eq("bracket", "single")
    .order("round_no", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastErr) return NextResponse.json({ error: lastErr.message }, { status: 500 });
  if (!last) return NextResponse.json({ error: "no_matches_yet" }, { status: 400 });

  const currentRound = last.round_no;

  const { data: matches, error: mErr } = await supabaseServer
    .from("tournament_matches")
    .select("id,status,winner_team_id,team_a_id,team_b_id")
    .eq("tournament_id", tournamentId)
    .eq("bracket", "single")
    .eq("round_no", currentRound)
    .order("match_no", { ascending: true });

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
  if (!matches || matches.length === 0)
    return NextResponse.json({ error: "round_has_no_matches" }, { status: 400 });

  const roundMatches = (matches ?? []) as RoundMatch[];
  const notFinished = roundMatches.filter((m) => m.status !== "finished");
  if (notFinished.length > 0) {
    return NextResponse.json(
      { error: "round_not_finished", remaining: notFinished.map((m) => m.id) },
      { status: 400 }
    );
  }

  const winners = roundMatches
    .map((m) => m.winner_team_id)
    .filter(Boolean) as string[];

  if (winners.length < 2) {
    return NextResponse.json({
      done: true,
      championTeamId: winners[0] ?? null,
      message: winners[0] ? "Turniej zakończony" : "Brak zwycięzcy",
    });
  }

  const pairs = pairUp(winners);
  const nextRound = currentRound + 1;
  const isFinal = pairs.length === 1;

  const inserts = pairs.map((p, idx) => {
    const isBye = !p.b;
    return {
      tournament_id: tournamentId,
      bracket: "single",
      round_no: nextRound,
      match_no: idx + 1,
      team_a_id: p.a,
      team_b_id: p.b,
      bo: isFinal ? t.bo_finals : t.bo_default,
      score_a: 0,
      score_b: 0,
      status: isBye ? "finished" : "pending",
      winner_team_id: isBye ? p.a : null,
    };
  });

  const { count: existsCount, error: eErr } = await supabaseServer
    .from("tournament_matches")
    .select("*", { count: "exact", head: true })
    .eq("tournament_id", tournamentId)
    .eq("bracket", "single")
    .eq("round_no", nextRound);

  if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 });
  if ((existsCount ?? 0) > 0) {
    return NextResponse.json({ error: "next_round_already_exists", round: nextRound }, { status: 400 });
  }

  const { data: created, error: insErr } = await supabaseServer
    .from("tournament_matches")
    .insert(inserts)
    .select("id,round_no,match_no,team_a_id,team_b_id,status,winner_team_id,bo");

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ created, nextRound, isFinal });
}
