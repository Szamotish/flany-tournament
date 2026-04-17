import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { generateTeams } from "@/lib/teams";

function assertAdmin(req: Request) {
  const pass = req.headers.get("x-admin-password");
  return !!pass && pass === process.env.ADMIN_PASSWORD;
}

export async function POST(req: Request) {
  if (!assertAdmin(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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

  const { data: players, error: playersErr } = await supabaseServer
    .from("players")
    .select("id,name,active")
    .eq("active", true)
    .order("created_at", { ascending: true });

  if (playersErr) {
    return NextResponse.json({ error: playersErr.message }, { status: 500 });
  }

  if (!players || players.length === 0) {
    return NextResponse.json({ error: "no_players" }, { status: 400 });
  }

  const ids = players.map((p) => p.id);

  const { data: avgRows, error: avgErr } = await supabaseServer
    .from("ratings")
    .select("rated_player_id, value")
    .in("rated_player_id", ids);

  if (avgErr) {
    return NextResponse.json({ error: avgErr.message }, { status: 500 });
  }

  const map: Record<string, number[]> = {};
  for (const r of avgRows ?? []) {
    const key = r.rated_player_id as string;
    map[key] = map[key] ?? [];
    map[key].push(Number(r.value));
  }

  const playersWithStrength = players.map((p) => {
    const arr = map[p.id] ?? [];
    const avg =
      arr.length === 0 ? 5 : arr.reduce((a, b) => a + b, 0) / arr.length;
    return { id: p.id, name: p.name, strength: avg };
  });

  const { teams, score } = generateTeams(
    playersWithStrength,
    teamSize,
    allowUneven,
    iterations
  );

  if (!teams || teams.length === 0) {
    return NextResponse.json({ error: "failed_to_generate" }, { status: 500 });
  }

  const { data: activeBatch } = await supabaseServer
  .from("team_batches")
  .select("id")
  .eq("is_active", true)
  .maybeSingle();

  if (activeBatch?.id) {
    if (mode === "overwrite") {
      const { error: delErr } = await supabaseServer
        .from("team_batches")
        .delete()
        .eq("id", activeBatch.id);

      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 500 });
      }
    } else {
      const { error: updErr } = await supabaseServer
        .from("team_batches")
        .update({ is_active: false })
        .eq("id", activeBatch.id);

      if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 });
      }
    }
  }

  const { data: batch, error: batchErr } = await supabaseServer
    .from("team_batches")
    .insert({
      team_size: teamSize,
      allow_uneven: allowUneven,
      iterations,
      is_active: true,
    })
    .select("id")
    .single();

  if (batchErr) {
    return NextResponse.json({ error: batchErr.message }, { status: 500 });
  }

  const batchId = batch.id as string;

  const teamInserts = teams.map((_, i) => ({
    batch_id: batchId,
    name: `Drużyna ${i + 1}`,
  }));

  const { data: teamRows, error: teamErr } = await supabaseServer
    .from("teams")
    .insert(teamInserts)
    .select("id,name");

  if (teamErr || !teamRows) {
    return NextResponse.json({ error: teamErr?.message ?? "team_insert_failed" }, { status: 500 });
  }

  const members = teamRows.flatMap((t, i) =>
    teams[i].map((p) => ({ team_id: t.id, player_id: p.id }))
  );

  const { error: memErr } = await supabaseServer
    .from("team_members")
    .insert(members);

  if (memErr) {
    return NextResponse.json({ error: memErr.message }, { status: 500 });
  }

  return NextResponse.json({ batchId, score });
}