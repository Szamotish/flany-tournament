import { NextResponse } from "next/server";
import { supabasePublic } from "@/lib/supabasePublic";

export const dynamic = "force-dynamic";

type PlayerBrief = { id: string; name: string };

function parsePlayerBrief(value: unknown): PlayerBrief | null {
  if (!value || typeof value !== "object") return null;
  const player = value as { id?: unknown; name?: unknown };
  if (typeof player.id !== "string" || typeof player.name !== "string") return null;
  return { id: player.id, name: player.name };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tournamentId } = await params;

  const { data: batch, error: bErr } = await supabasePublic
    .from("team_batches")
    .select("id, created_at, team_size")
    .eq("tournament_id", tournamentId)
    .eq("is_active", true)
    .maybeSingle();

  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });
  if (!batch) return NextResponse.json({ batch: null, teams: [] });

  const { data: teams, error: tErr } = await supabasePublic
    .from("teams")
    .select("id, name")
    .eq("batch_id", batch.id)
    .order("name", { ascending: true });

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

  const teamIds = (teams ?? []).map((t) => t.id);

  const { data: members, error: mErr } = await supabasePublic
    .from("team_members")
    .select("team_id, player_id, players(id,name)")
    .in("team_id", teamIds);

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  const grouped: Record<string, { id: string; name: string }[]> = {};
  for (const m of members ?? []) {
    const tid = m.team_id as string;
    const p = parsePlayerBrief((m as { players?: unknown }).players);
    if (!p) continue;
    grouped[tid] = grouped[tid] ?? [];
    grouped[tid].push({ id: p.id, name: p.name });
  }

  const result = (teams ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    players: (grouped[t.id] ?? []).sort((a, b) => a.name.localeCompare(b.name)),
  }));

  return NextResponse.json({ batch, teams: result });
}
