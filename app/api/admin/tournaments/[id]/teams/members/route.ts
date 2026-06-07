import { NextResponse } from "next/server";
import { assertTournamentAdmin } from "@/app/api/admin/tournaments/_auth";
import { writeAuditLog } from "@/lib/auditLog";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { supabaseServer } from "@/lib/supabaseServer";

async function activeTeamIds(tournamentId: string): Promise<string[]> {
  const batchRes = await supabaseServer
    .from("team_batches")
    .select("id")
    .eq("tournament_id", tournamentId)
    .eq("is_active", true)
    .maybeSingle();

  if (batchRes.error) throw new Error(batchRes.error.message);
  if (!batchRes.data?.id) throw new Error("active_batch_not_found");

  const teamsRes = await supabaseServer
    .from("teams")
    .select("id")
    .eq("batch_id", batchRes.data.id);

  if (teamsRes.error) throw new Error(teamsRes.error.message);
  return (teamsRes.data ?? []).map((team) => String(team.id)).filter(Boolean);
}

async function assertPlayerInTournament(tournamentId: string, playerId: string) {
  const membership = await supabaseServer
    .from("tournament_players")
    .select("player_id")
    .eq("tournament_id", tournamentId)
    .eq("player_id", playerId)
    .maybeSingle();

  if (membership.error) throw new Error(membership.error.message);
  if (!membership.data) throw new Error("player_not_in_tournament");
}

async function setTournamentPlayerStatus(
  tournamentId: string,
  playerId: string,
  status: "participant" | "spectator",
) {
  const update = await supabaseServer
    .from("tournament_players")
    .update({ participation_status: status })
    .eq("tournament_id", tournamentId)
    .eq("player_id", playerId);

  if (update.error) {
    if (update.error.message.includes("participation_status")) {
      throw new Error("missing_tournament_player_status_schema");
    }
    throw new Error(update.error.message);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ip = clientIp(req);
  const ipLimit = rateLimit({ key: `team-members-delete:ip:${ip}`, limit: 120, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);

  const { id: tournamentId } = await params;
  const auth = await assertTournamentAdmin(req, tournamentId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });

  const body = await req.json().catch(() => null);
  const playerId = String(body?.playerId ?? "");
  if (!playerId) return NextResponse.json({ error: "missing_playerId" }, { status: 400 });

  try {
    await assertPlayerInTournament(tournamentId, playerId);
    const teamIds = await activeTeamIds(tournamentId);
    if (teamIds.length === 0) return NextResponse.json({ error: "no_active_teams" }, { status: 400 });

    const remove = await supabaseServer
      .from("team_members")
      .delete()
      .eq("player_id", playerId)
      .in("team_id", teamIds);
    if (remove.error) throw new Error(remove.error.message);

    await setTournamentPlayerStatus(tournamentId, playerId, "spectator");

    await writeAuditLog({
      actorUserId: auth.ctx.userId,
      actorPlayerId: auth.ctx.playerId,
      action: "team_member_make_spectator",
      targetType: "tournament",
      targetId: tournamentId,
      metadata: { playerId },
    });

    return NextResponse.json({ ok: true, playerId, participationStatus: "spectator" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "player_not_in_tournament" || message === "active_batch_not_found" ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ip = clientIp(req);
  const ipLimit = rateLimit({ key: `team-members-move:ip:${ip}`, limit: 120, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);

  const { id: tournamentId } = await params;
  const auth = await assertTournamentAdmin(req, tournamentId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });

  const body = await req.json().catch(() => null);
  const playerId = String(body?.playerId ?? "");
  const targetTeamId = String(body?.targetTeamId ?? "");
  if (!playerId) return NextResponse.json({ error: "missing_playerId" }, { status: 400 });
  if (!targetTeamId) return NextResponse.json({ error: "missing_targetTeamId" }, { status: 400 });

  try {
    await assertPlayerInTournament(tournamentId, playerId);
    const teamIds = await activeTeamIds(tournamentId);
    if (!teamIds.includes(targetTeamId)) {
      return NextResponse.json({ error: "target_team_not_in_active_batch" }, { status: 400 });
    }

    const remove = await supabaseServer
      .from("team_members")
      .delete()
      .eq("player_id", playerId)
      .in("team_id", teamIds);
    if (remove.error) throw new Error(remove.error.message);

    const insert = await supabaseServer
      .from("team_members")
      .insert({ team_id: targetTeamId, player_id: playerId });
    if (insert.error) throw new Error(insert.error.message);

    await setTournamentPlayerStatus(tournamentId, playerId, "participant");

    await writeAuditLog({
      actorUserId: auth.ctx.userId,
      actorPlayerId: auth.ctx.playerId,
      action: "team_member_move",
      targetType: "tournament",
      targetId: tournamentId,
      metadata: { playerId, targetTeamId },
    });

    return NextResponse.json({ ok: true, playerId, targetTeamId, participationStatus: "participant" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "player_not_in_tournament" || message === "active_batch_not_found" ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

