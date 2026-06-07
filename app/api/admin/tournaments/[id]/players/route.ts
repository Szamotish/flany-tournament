import { NextResponse } from "next/server";
import { assertTournamentAdmin } from "@/app/api/admin/tournaments/_auth";
import { writeAuditLog } from "@/lib/auditLog";
import { supabaseServer } from "@/lib/supabaseServer";
import { isOneVsOneFormat, ONE_V_ONE_PLAYER_LIMIT } from "@/lib/tournamentFormat";

function parsePlayer(value: unknown): { id: string; name: string; active: boolean } | null {
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

type TournamentPlayerListRow = {
  player_id?: string | null;
  participation_status?: string | null;
  players?: unknown;
};

async function ensureNotStarted(tournamentId: string) {
  const { count, error } = await supabaseServer
    .from("tournament_matches")
    .select("*", { count: "exact", head: true })
    .eq("tournament_id", tournamentId);

  if (error) return { ok: false as const, error: error.message, status: 500 };
  if ((count ?? 0) > 0) {
    return { ok: false as const, error: "tournament_already_started", status: 400 };
  }
  return { ok: true as const };
}

async function deactivateActiveBatch(tournamentId: string) {
  const { error } = await supabaseServer
    .from("team_batches")
    .update({ is_active: false })
    .eq("tournament_id", tournamentId)
    .eq("is_active", true);
  return error;
}

async function readTournamentFormatAndPlayerCount(tournamentId: string): Promise<{
  format: string | null;
  playerCount: number;
}> {
  const [tournamentRes, countRes] = await Promise.all([
    supabaseServer.from("tournaments").select("format").eq("id", tournamentId).maybeSingle(),
    supabaseServer
      .from("tournament_players")
      .select("*", { count: "exact", head: true })
      .eq("tournament_id", tournamentId),
  ]);

  if (tournamentRes.error) throw new Error(tournamentRes.error.message);
  if (countRes.error) throw new Error(countRes.error.message);

  return {
    format: typeof tournamentRes.data?.format === "string" ? tournamentRes.data.format : null,
    playerCount: countRes.count ?? 0,
  };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tournamentId } = await params;

  const auth = await assertTournamentAdmin(req, tournamentId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });

  let data: TournamentPlayerListRow[] | null = null;
  let error: { message: string } | null = null;

  const primary = await supabaseServer
    .from("tournament_players")
    .select("player_id,participation_status, players(id,name,active)")
    .eq("tournament_id", tournamentId);

  data = primary.data as TournamentPlayerListRow[] | null;
  error = primary.error;

  if (primary.error && primary.error.message.includes("participation_status")) {
    const fallback = await supabaseServer
      .from("tournament_players")
      .select("player_id, players(id,name,active)")
      .eq("tournament_id", tournamentId);
    data = (fallback.data ?? []).map((row) => ({ ...row, participation_status: "participant" })) as TournamentPlayerListRow[];
    error = fallback.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const players = (data ?? [])
    .map((row) => {
      const player = parsePlayer((row as { players?: unknown }).players);
      if (!player) return null;
      return {
        ...player,
        participationStatus: row.participation_status === "spectator" ? "spectator" : "participant",
      };
    })
    .filter((p): p is { id: string; name: string; active: boolean; participationStatus: string } => Boolean(p))
    .sort((a, b) => a.name.localeCompare(b.name, "pl"));

  return NextResponse.json({ players });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tournamentId } = await params;

  const auth = await assertTournamentAdmin(req, tournamentId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });

  const started = await ensureNotStarted(tournamentId);
  if (!started.ok) return NextResponse.json({ error: started.error }, { status: started.status });

  const body = await req.json().catch(() => null);
  const playerId = String(body?.playerId ?? "");
  if (!playerId) return NextResponse.json({ error: "missing_playerId" }, { status: 400 });

  const { data: player, error: pErr } = await supabaseServer
    .from("players")
    .select("id,active")
    .eq("id", playerId)
    .maybeSingle();

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!player) return NextResponse.json({ error: "player_not_found" }, { status: 404 });
  if (!player.active) return NextResponse.json({ error: "player_inactive" }, { status: 400 });

  const { format, playerCount } = await readTournamentFormatAndPlayerCount(tournamentId);
  if (isOneVsOneFormat(format) && playerCount >= ONE_V_ONE_PLAYER_LIMIT) {
    return NextResponse.json({ error: "tournament_1v1_player_limit_reached" }, { status: 400 });
  }

  const { error: upsertErr } = await supabaseServer.from("tournament_players").upsert(
    { tournament_id: tournamentId, player_id: playerId, participation_status: "participant" },
    { onConflict: "tournament_id,player_id", ignoreDuplicates: true }
  );
  if (upsertErr) {
    if (upsertErr.message.includes("participation_status")) {
      const legacy = await supabaseServer.from("tournament_players").upsert(
        { tournament_id: tournamentId, player_id: playerId },
        { onConflict: "tournament_id,player_id", ignoreDuplicates: true }
      );
      if (legacy.error) return NextResponse.json({ error: legacy.error.message }, { status: 500 });
    } else {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }
  }

  const nowIso = new Date().toISOString();
  const acceptRequest = await supabaseServer
    .from("tournament_join_requests")
    .update({
      status: "accepted",
      resolved_at: nowIso,
      resolved_by_player_id: auth.ctx.playerId ?? null,
    })
    .eq("tournament_id", tournamentId)
    .eq("player_id", playerId)
    .eq("status", "pending");
  if (acceptRequest.error && !acceptRequest.error.message.includes("tournament_join_requests")) {
    return NextResponse.json({ error: acceptRequest.error.message }, { status: 500 });
  }

  const acceptInvite = await supabaseServer
    .from("tournament_invites")
    .update({
      status: "accepted",
      resolved_at: nowIso,
    })
    .eq("tournament_id", tournamentId)
    .eq("player_id", playerId)
    .eq("status", "pending");
  if (acceptInvite.error && !acceptInvite.error.message.includes("tournament_invites")) {
    return NextResponse.json({ error: acceptInvite.error.message }, { status: 500 });
  }

  const batchErr = await deactivateActiveBatch(tournamentId);
  if (batchErr) return NextResponse.json({ error: batchErr.message }, { status: 500 });

  await writeAuditLog({
    actorUserId: auth.ctx.userId,
    actorPlayerId: auth.ctx.playerId,
    action: "tournament_player_add",
    targetType: "tournament",
    targetId: tournamentId,
    metadata: { playerId },
  });

  return NextResponse.json({ added: true, playerId, needsRegenerateTeams: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tournamentId } = await params;

  const auth = await assertTournamentAdmin(req, tournamentId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });

  const started = await ensureNotStarted(tournamentId);
  if (!started.ok) return NextResponse.json({ error: started.error }, { status: started.status });

  const body = await req.json().catch(() => null);
  const playerId = String(body?.playerId ?? "");
  if (!playerId) return NextResponse.json({ error: "missing_playerId" }, { status: 400 });

  const { error: delErr } = await supabaseServer
    .from("tournament_players")
    .delete()
    .eq("tournament_id", tournamentId)
    .eq("player_id", playerId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  const nowIso = new Date().toISOString();
  const cancelReq = await supabaseServer
    .from("tournament_join_requests")
    .update({
      status: "cancelled",
      resolved_at: nowIso,
      resolved_by_player_id: auth.ctx.playerId ?? null,
    })
    .eq("tournament_id", tournamentId)
    .eq("player_id", playerId)
    .eq("status", "pending");
  if (cancelReq.error && !cancelReq.error.message.includes("tournament_join_requests")) {
    return NextResponse.json({ error: cancelReq.error.message }, { status: 500 });
  }

  const cancelInvite = await supabaseServer
    .from("tournament_invites")
    .update({
      status: "cancelled",
      resolved_at: nowIso,
    })
    .eq("tournament_id", tournamentId)
    .eq("player_id", playerId)
    .eq("status", "pending");
  if (cancelInvite.error && !cancelInvite.error.message.includes("tournament_invites")) {
    return NextResponse.json({ error: cancelInvite.error.message }, { status: 500 });
  }

  const { error: delAdminErr } = await supabaseServer
    .from("tournament_admins")
    .delete()
    .eq("tournament_id", tournamentId)
    .eq("player_id", playerId);
  if (delAdminErr && !delAdminErr.message.includes("tournament_admins")) {
    return NextResponse.json({ error: delAdminErr.message }, { status: 500 });
  }

  const batchErr = await deactivateActiveBatch(tournamentId);
  if (batchErr) return NextResponse.json({ error: batchErr.message }, { status: 500 });

  await writeAuditLog({
    actorUserId: auth.ctx.userId,
    actorPlayerId: auth.ctx.playerId,
    action: "tournament_player_remove",
    targetType: "tournament",
    targetId: tournamentId,
    metadata: { playerId },
  });

  return NextResponse.json({ removed: true, playerId, needsRegenerateTeams: true });
}
