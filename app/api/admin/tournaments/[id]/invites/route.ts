import { NextResponse } from "next/server";
import { assertTournamentAdmin } from "@/app/api/admin/tournaments/_auth";
import { supabaseServer } from "@/lib/supabaseServer";

async function hasTournamentStarted(tournamentId: string): Promise<boolean> {
  const { count } = await supabaseServer
    .from("tournament_matches")
    .select("*", { count: "exact", head: true })
    .eq("tournament_id", tournamentId);
  return (count ?? 0) > 0;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tournamentId } = await params;
  const auth = await assertTournamentAdmin(req, tournamentId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });

  const { data, error } = await supabaseServer
    .from("tournament_invites")
    .select("id,status,created_at,player_id,invited_by_player_id")
    .eq("tournament_id", tournamentId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    if (error.message.includes("tournament_invites")) {
      return NextResponse.json({ error: "missing_invites_schema" }, { status: 500 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const playerIds = Array.from(new Set((data ?? []).map((row) => String(row.player_id ?? "")).filter(Boolean)));
  const playersRes =
    playerIds.length > 0
      ? await supabaseServer.from("players").select("id,name,avatar_url").in("id", playerIds)
      : { data: [], error: null };

  if (playersRes.error) return NextResponse.json({ error: playersRes.error.message }, { status: 500 });

  const playersMap = new Map(
    (playersRes.data ?? []).map((row) => [String(row.id), { id: row.id, name: row.name, avatar_url: row.avatar_url }])
  );
  const invites = (data ?? []).map((row) => ({
    ...row,
    players: playersMap.get(String(row.player_id ?? "")) ?? null,
  }));

  return NextResponse.json({ invites });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tournamentId } = await params;
  const auth = await assertTournamentAdmin(req, tournamentId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });
  if (!auth.ctx.playerId) return NextResponse.json({ error: "missing_admin_player" }, { status: 403 });

  if (await hasTournamentStarted(tournamentId)) {
    return NextResponse.json({ error: "tournament_already_started" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const invitedPlayerId = typeof body?.playerId === "string" ? body.playerId : "";
  if (!invitedPlayerId) return NextResponse.json({ error: "missing_playerId" }, { status: 400 });

  const playerRes = await supabaseServer
    .from("players")
    .select("id,active,auth_user_id")
    .eq("id", invitedPlayerId)
    .maybeSingle();

  if (playerRes.error) return NextResponse.json({ error: playerRes.error.message }, { status: 500 });
  if (!playerRes.data?.id) return NextResponse.json({ error: "player_not_found" }, { status: 404 });
  if (playerRes.data.active !== true) return NextResponse.json({ error: "player_inactive" }, { status: 400 });
  if (!playerRes.data.auth_user_id) {
    return NextResponse.json({ error: "player_has_no_account" }, { status: 400 });
  }

  const memberRes = await supabaseServer
    .from("tournament_players")
    .select("player_id")
    .eq("tournament_id", tournamentId)
    .eq("player_id", invitedPlayerId)
    .maybeSingle();

  if (memberRes.error) return NextResponse.json({ error: memberRes.error.message }, { status: 500 });
  if (memberRes.data) return NextResponse.json({ error: "already_in_tournament" }, { status: 400 });

  const existingPending = await supabaseServer
    .from("tournament_invites")
    .select("id,status")
    .eq("tournament_id", tournamentId)
    .eq("player_id", invitedPlayerId)
    .eq("status", "pending")
    .maybeSingle();

  if (existingPending.error && !existingPending.error.message.includes("tournament_invites")) {
    return NextResponse.json({ error: existingPending.error.message }, { status: 500 });
  }
  if (existingPending.data) {
    return NextResponse.json({ error: "invite_already_pending" }, { status: 400 });
  }

  const insertRes = await supabaseServer
    .from("tournament_invites")
    .insert({
      tournament_id: tournamentId,
      player_id: invitedPlayerId,
      invited_by_player_id: auth.ctx.playerId,
      status: "pending",
    })
    .select("id,status,created_at")
    .single();

  if (insertRes.error) {
    if (insertRes.error.message.includes("tournament_invites")) {
      return NextResponse.json({ error: "missing_invites_schema" }, { status: 500 });
    }
    return NextResponse.json({ error: insertRes.error.message }, { status: 500 });
  }

  return NextResponse.json({ invite: insertRes.data });
}
