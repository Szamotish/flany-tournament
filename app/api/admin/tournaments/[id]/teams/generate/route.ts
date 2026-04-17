import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { generateTeams } from "@/lib/teams";
import { assertTournamentAdmin } from "@/app/api/admin/tournaments/_auth";

type TournamentPlayer = {
  id: string;
  name: string;
  active: boolean;
};

function parseTournamentPlayer(value: unknown): TournamentPlayer | null {
  const source = Array.isArray(value) ? value[0] : value;
  if (!source || typeof source !== "object") return null;
  const player = source as { id?: unknown; name?: unknown; active?: unknown };
  if (
    typeof player.id !== "string" ||
    typeof player.name !== "string" ||
    typeof player.active !== "boolean"
  ) {
    return null;
  }
  return { id: player.id, name: player.name, active: player.active };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tournamentId } = await params;

  const auth = await assertTournamentAdmin(req, tournamentId);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const teamSize = Number(body?.teamSize ?? 5);
  const allowUneven = body?.allowUneven !== false;
  const iterations = Number(body?.iterations ?? 500);
  const mode = (body?.mode === "overwrite" ? "overwrite" : "reset") as
    | "reset"
    | "overwrite";

  if (!Number.isInteger(teamSize) || teamSize < 2 || teamSize > 20) {
    return NextResponse.json({ error: "invalid_teamSize" }, { status: 400 });
  }
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 5000) {
    return NextResponse.json({ error: "invalid_iterations" }, { status: 400 });
  }

  const { data: tp, error: tpErr } = await supabaseServer
    .from("tournament_players")
    .select("player_id, players(id,name,active)")
    .eq("tournament_id", tournamentId);

  if (tpErr) return NextResponse.json({ error: tpErr.message }, { status: 500 });

  const players = (tp ?? [])
    .map((x) => parseTournamentPlayer((x as { players?: unknown }).players))
    .filter((p): p is TournamentPlayer => Boolean(p && p.active));

  if (players.length < 2) {
    return NextResponse.json({ error: "not_enough_players" }, { status: 400 });
  }

  const ids = players.map((p) => p.id);

  const { data: ratingRows, error: rErr } = await supabaseServer
    .from("ratings")
    .select("rated_player_id, value")
    .in("rated_player_id", ids);

  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

  const map: Record<string, number[]> = {};
  for (const r of ratingRows ?? []) {
    const key = r.rated_player_id as string;
    map[key] = map[key] ?? [];
    map[key].push(Number(r.value));
  }

  const playersWithStrength = players.map((p) => {
    const arr = map[p.id] ?? [];
    const avg = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 5;
    return { id: p.id, name: p.name, strength: avg };
  });

  const { data: activeBatch } = await supabaseServer
    .from("team_batches")
    .select("id")
    .eq("tournament_id", tournamentId)
    .eq("is_active", true)
    .maybeSingle();

  if (activeBatch?.id) {
    if (mode === "overwrite") {
      const { error: delErr } = await supabaseServer
        .from("team_batches")
        .delete()
        .eq("id", activeBatch.id);

      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    } else {
      const { error: updErr } = await supabaseServer
        .from("team_batches")
        .update({ is_active: false })
        .eq("id", activeBatch.id);

      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    }
  }

  const { teams, score } = generateTeams(
    playersWithStrength,
    teamSize,
    allowUneven,
    iterations
  );

  if (!teams || teams.length === 0) {
    return NextResponse.json({ error: "failed_to_generate" }, { status: 500 });
  }

  const { data: batch, error: bErr } = await supabaseServer
    .from("team_batches")
    .insert({
      tournament_id: tournamentId,
      team_size: teamSize,
      allow_uneven: allowUneven,
      iterations,
      is_active: true,
    })
    .select("id")
    .single();

  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });

  const batchId = batch.id as string;

  const teamInserts = teams.map((_, i) => ({
    batch_id: batchId,
    name: `Drużyna ${i + 1}`,
  }));

  const { data: teamRows, error: tErr } = await supabaseServer
    .from("teams")
    .insert(teamInserts)
    .select("id,name");

  if (tErr || !teamRows) {
    return NextResponse.json({ error: tErr?.message ?? "team_insert_failed" }, { status: 500 });
  }

  const members = teamRows.flatMap((t, i) =>
    teams[i].map((p) => ({ team_id: t.id, player_id: p.id }))
  );

  const { error: mErr } = await supabaseServer.from("team_members").insert(members);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  return NextResponse.json({ batchId, score });
}
