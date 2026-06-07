import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { assertTournamentAdmin } from "@/app/api/admin/tournaments/_auth";
import { buildDoubleElimBracket } from "@/lib/matches/buildDoubleElim";
import { nextStepDoubleElim } from "@/lib/matches/nextStepDouble";
import { markTournamentStarted } from "@/lib/tournaments/markStarted";

type TeamRow = {
  id: string;
  name: string;
};

function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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

  const { data: t, error: tErr } = await supabaseServer
    .from("tournaments")
    .select("id, bo_default, bo_finals, format")
    .eq("id", tournamentId)
    .single();

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

  const { data: batch, error: bErr } = await supabaseServer
    .from("team_batches")
    .select("id")
    .eq("tournament_id", tournamentId)
    .eq("is_active", true)
    .maybeSingle();

  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });
  if (!batch) return NextResponse.json({ error: "no_active_teams_batch" }, { status: 400 });

  const { data: teams, error: teamsErr } = await supabaseServer
    .from("teams")
    .select("id,name")
    .eq("batch_id", batch.id);

  if (teamsErr) return NextResponse.json({ error: teamsErr.message }, { status: 500 });
  if (!teams || teams.length < 2) {
    return NextResponse.json({ error: "not_enough_teams" }, { status: 400 });
  }

  const { count, error: cErr } = await supabaseServer
    .from("tournament_matches")
    .select("*", { count: "exact", head: true })
    .eq("tournament_id", tournamentId);

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: "matches_already_exist" }, { status: 400 });
  }

  if (t.format === "double_elim") {
    try {
      const built = await buildDoubleElimBracket(tournamentId, { clearExisting: false });
      const stepped = await nextStepDoubleElim(tournamentId);
      await markTournamentStarted(tournamentId);
      return NextResponse.json({ ...built, autoStep: stepped });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      const status = message === "not_double_elim" ? 400 : 500;
      return NextResponse.json({ error: message }, { status });
    }
  }

  const shuffled = shuffle((teams ?? []) as TeamRow[]);
  const pairs: { a: TeamRow; b: TeamRow | null }[] = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    pairs.push({ a: shuffled[i], b: shuffled[i + 1] ?? null });
  }

  const inserts = pairs.map((p, idx) => {
    const isBye = !p.b;
    return {
      tournament_id: tournamentId,
      bracket: t.format === "double_elim" ? "winners" : "single",
      round_no: 1,
      match_no: idx + 1,
      team_a_id: p.a.id,
      team_b_id: p.b?.id ?? null,
      bo: t.bo_default,
      score_a: 0,
      score_b: 0,
      status: isBye ? "finished" : "pending",
      winner_team_id: isBye ? p.a.id : null,
    };
  });

  const { data: created, error: insErr } = await supabaseServer
    .from("tournament_matches")
    .insert(inserts)
    .select("id, round_no, match_no, team_a_id, team_b_id, status, winner_team_id");

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  try {
    await markTournamentStarted(tournamentId);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ created });
}
