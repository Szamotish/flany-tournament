import { NextResponse } from "next/server";
import { supabasePublic } from "@/lib/supabasePublic";
import { pickTeamCaptainId } from "@/lib/teamCaptain";

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

  const [batchRes, tournamentRes] = await Promise.all([
    supabasePublic
      .from("team_batches")
      .select("id, created_at, team_size")
      .eq("tournament_id", tournamentId)
      .eq("is_active", true)
      .maybeSingle(),
    supabasePublic
      .from("tournaments")
      .select("format")
      .eq("id", tournamentId)
      .maybeSingle(),
  ]);

  const batch = batchRes.data;
  const bErr = batchRes.error;

  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });
  if (tournamentRes.error) return NextResponse.json({ error: tournamentRes.error.message }, { status: 500 });
  if (!batch) return NextResponse.json({ batch: null, teams: [] });

  const isOneVsOne = tournamentRes.data?.format === "one_vs_one";

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
  const activePlayerIds = new Set<string>();
  for (const m of members ?? []) {
    const tid = m.team_id as string;
    const p = parsePlayerBrief((m as { players?: unknown }).players);
    if (!p) continue;
    activePlayerIds.add(p.id);
    grouped[tid] = grouped[tid] ?? [];
    grouped[tid].push({ id: p.id, name: p.name });
  }

  let tournamentPlayers: Array<{ participation_status?: string | null; players?: unknown }> = [];
  const tournamentPlayersPrimary = await supabasePublic
    .from("tournament_players")
    .select("participation_status, players(id,name)")
    .eq("tournament_id", tournamentId);

  if (tournamentPlayersPrimary.error && tournamentPlayersPrimary.error.message.includes("participation_status")) {
    const fallback = await supabasePublic
      .from("tournament_players")
      .select("players(id,name)")
      .eq("tournament_id", tournamentId);
    if (fallback.error) return NextResponse.json({ error: fallback.error.message }, { status: 500 });
    tournamentPlayers = (fallback.data ?? []).map((row) => ({ ...row, participation_status: "participant" }));
  } else if (tournamentPlayersPrimary.error) {
    return NextResponse.json({ error: tournamentPlayersPrimary.error.message }, { status: 500 });
  } else {
    tournamentPlayers = tournamentPlayersPrimary.data ?? [];
  }

  const spectators = tournamentPlayers
    .map((row) => {
      const player = parsePlayerBrief((row as { players?: unknown }).players);
      if (!player) return null;
      const explicitSpectator = row.participation_status === "spectator";
      if (!explicitSpectator && activePlayerIds.has(player.id)) return null;
      return { ...player, participationStatus: "spectator" };
    })
    .filter((player): player is { id: string; name: string; participationStatus: string } => Boolean(player))
    .sort((a, b) => a.name.localeCompare(b.name, "pl"));

  const result = (teams ?? []).map((t) => {
    const roster = (grouped[t.id] ?? []).sort((a, b) => a.name.localeCompare(b.name));
    const captainPlayerId = isOneVsOne ? null : pickTeamCaptainId(String(t.id), roster.map((player) => player.id));
    return {
      id: t.id,
      name: t.name,
      captainPlayerId,
      players: roster.map((player) => ({
        ...player,
        isCaptain: captainPlayerId === player.id,
      })),
    };
  });

  return NextResponse.json({ batch, teams: result, spectators });
}
