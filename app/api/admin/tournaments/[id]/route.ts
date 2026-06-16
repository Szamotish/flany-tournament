import { NextResponse } from "next/server";
import { assertMainAdmin } from "@/app/api/admin/_auth";
import { writeAuditLog } from "@/lib/auditLog";
import { supabaseServer } from "@/lib/supabaseServer";
import { normalizeMode } from "@/lib/ranked";
import {
  normalizeTournamentFormat,
  ONE_V_ONE_PLAYER_LIMIT,
  isOneVsOneFormat,
} from "@/lib/tournamentFormat";

function parseBo(value: unknown): 1 | 3 | 5 {
  const n = Number(value);
  if (n === 3) return 3;
  if (n === 5) return 5;
  return 1;
}

async function tournamentStarted(tournamentId: string) {
  const { count, error } = await supabaseServer
    .from("tournament_matches")
    .select("*", { count: "exact", head: true })
    .eq("tournament_id", tournamentId);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, started: (count ?? 0) > 0 };
}

function isMissingOptionalRelation(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("does not exist") || normalized.includes("schema cache") || normalized.includes("could not find");
}

async function deleteOptionalRows(table: string, tournamentId: string): Promise<string | null> {
  const { error } = await supabaseServer.from(table).delete().eq("tournament_id", tournamentId);
  if (!error || isMissingOptionalRelation(error.message)) return null;
  return error.message;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await assertMainAdmin(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const { id: tournamentId } = await params;

  const [tournamentRes, playersRes, adminsRes, startedRes] = await Promise.all([
    supabaseServer
      .from("tournaments")
      .select("id,name,created_at,format,mode,bo_default,bo_finals,gf_reset_enabled,event_at,event_location,join_deadline_at,is_private")
      .eq("id", tournamentId)
      .maybeSingle(),
    supabaseServer
      .from("tournament_players")
      .select("player_id")
      .eq("tournament_id", tournamentId),
    supabaseServer
      .from("tournament_admins")
      .select("player_id")
      .eq("tournament_id", tournamentId),
    tournamentStarted(tournamentId),
  ]);

  if (tournamentRes.error) return NextResponse.json({ error: tournamentRes.error.message }, { status: 500 });
  if (!tournamentRes.data) return NextResponse.json({ error: "tournament_not_found" }, { status: 404 });
  if (playersRes.error) return NextResponse.json({ error: playersRes.error.message }, { status: 500 });
  if (adminsRes.error && !adminsRes.error.message.includes("tournament_admins")) {
    return NextResponse.json({ error: adminsRes.error.message }, { status: 500 });
  }
  if (!startedRes.ok) return NextResponse.json({ error: startedRes.error }, { status: 500 });

  return NextResponse.json({
    tournament: tournamentRes.data,
    playerIds: (playersRes.data ?? []).map((row) => String(row.player_id)),
    localAdminPlayerIds: (adminsRes.data ?? []).map((row) => String(row.player_id)),
    started: startedRes.started,
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await assertMainAdmin(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const { id: tournamentId } = await params;
  const body = await req.json().catch(() => null);

  const existingRes = await supabaseServer
    .from("tournaments")
    .select("id,name,format,mode,bo_default,bo_finals,gf_reset_enabled")
    .eq("id", tournamentId)
    .maybeSingle();

  if (existingRes.error) return NextResponse.json({ error: existingRes.error.message }, { status: 500 });
  if (!existingRes.data) return NextResponse.json({ error: "tournament_not_found" }, { status: 404 });

  const name = String(body?.name ?? "").trim();
  const format = normalizeTournamentFormat(body?.format);
  const mode = normalizeMode(body?.mode);
  const boDefault = parseBo(body?.boDefault);
  const boFinals = parseBo(body?.boFinals);
  const gfResetEnabled = Boolean(body?.gfResetEnabled ?? false);
  const eventAtRaw = typeof body?.eventAt === "string" ? body.eventAt.trim() : "";
  const joinDeadlineAtRaw = typeof body?.joinDeadlineAt === "string" ? body.joinDeadlineAt.trim() : "";
  const eventLocation = typeof body?.eventLocation === "string" ? body.eventLocation.trim().slice(0, 140) : "";
  const isPrivate = body?.isPrivate === true;

  const playerIds: string[] = Array.isArray(body?.playerIds)
    ? Array.from(new Set(body.playerIds.map((value: unknown) => String(value)).filter(Boolean)))
    : [];
  const localAdminPlayerIdsRaw: string[] = Array.isArray(body?.localAdminPlayerIds)
    ? Array.from(new Set(body.localAdminPlayerIds.map((value: unknown) => String(value)).filter(Boolean)))
    : [];
  const localAdminPlayerIds = Array.from(
    new Set([...(localAdminPlayerIdsRaw ?? []), ...(admin.ctx.playerId ? [admin.ctx.playerId] : [])])
  );

  if (!name) return NextResponse.json({ error: "missing_name" }, { status: 400 });
  if (playerIds.length < 2) return NextResponse.json({ error: "invalid_playerIds" }, { status: 400 });
  if (isOneVsOneFormat(format) && playerIds.length !== ONE_V_ONE_PLAYER_LIMIT) {
    return NextResponse.json({ error: "invalid_playerIds_1v1_requires_exactly_2" }, { status: 400 });
  }
  if (localAdminPlayerIds.length === 0) {
    return NextResponse.json({ error: "missing_localAdminPlayerIds" }, { status: 400 });
  }

  const eventAt = eventAtRaw ? new Date(eventAtRaw) : null;
  if (eventAtRaw && Number.isNaN(eventAt?.getTime())) {
    return NextResponse.json({ error: "invalid_eventAt" }, { status: 400 });
  }

  const joinDeadlineAt = joinDeadlineAtRaw ? new Date(joinDeadlineAtRaw) : null;
  if (joinDeadlineAtRaw && Number.isNaN(joinDeadlineAt?.getTime())) {
    return NextResponse.json({ error: "invalid_joinDeadlineAt" }, { status: 400 });
  }

  const started = await tournamentStarted(tournamentId);
  if (!started.ok) return NextResponse.json({ error: started.error }, { status: 500 });

  const structuralChanged =
    existingRes.data.format !== format ||
    existingRes.data.mode !== mode ||
    Number(existingRes.data.bo_default) !== boDefault ||
    Number(existingRes.data.bo_finals) !== boFinals ||
    Boolean(existingRes.data.gf_reset_enabled) !== (format === "double_elim" ? gfResetEnabled : false);

  if (started.started && structuralChanged) {
    return NextResponse.json({ error: "tournament_started_cannot_change_structure" }, { status: 400 });
  }

  const { data: selectedPlayers, error: selectedPlayersErr } = await supabaseServer
    .from("players")
    .select("id,auth_user_id,active")
    .in("id", Array.from(new Set([...playerIds, ...localAdminPlayerIds])));

  if (selectedPlayersErr) return NextResponse.json({ error: selectedPlayersErr.message }, { status: 500 });

  const playerMap = new Map((selectedPlayers ?? []).map((row) => [String(row.id), row]));
  if (playerIds.some((id) => !playerMap.has(id))) {
    return NextResponse.json({ error: "some_players_not_found" }, { status: 400 });
  }
  if (playerIds.some((id) => playerMap.get(id)?.active !== true)) {
    return NextResponse.json({ error: "selected_player_inactive" }, { status: 400 });
  }
  if (
    localAdminPlayerIds.some((id) => {
      const player = playerMap.get(id);
      return !player || player.active !== true || player.auth_user_id === null;
    })
  ) {
    return NextResponse.json({ error: "local_admin_requires_active_account" }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("tournaments")
    .update({
      name,
      format,
      mode,
      bo_default: boDefault,
      bo_finals: boFinals,
      gf_reset_enabled: format === "double_elim" ? gfResetEnabled : false,
      event_at: eventAt ? eventAt.toISOString() : null,
      event_location: eventLocation || null,
      join_deadline_at: joinDeadlineAt ? joinDeadlineAt.toISOString() : null,
      is_private: isPrivate,
    })
    .eq("id", tournamentId)
    .select("id,name,format,mode,bo_default,bo_finals,gf_reset_enabled,event_at,event_location,join_deadline_at,is_private")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!started.started) {
    const delPlayers = await supabaseServer.from("tournament_players").delete().eq("tournament_id", tournamentId);
    if (delPlayers.error) return NextResponse.json({ error: delPlayers.error.message }, { status: 500 });
    const playerRows = playerIds.map((playerId) => ({ tournament_id: tournamentId, player_id: playerId }));
    const insPlayers = await supabaseServer.from("tournament_players").insert(playerRows);
    if (insPlayers.error) return NextResponse.json({ error: insPlayers.error.message }, { status: 500 });
  }

  const delAdmins = await supabaseServer.from("tournament_admins").delete().eq("tournament_id", tournamentId);
  if (delAdmins.error && !delAdmins.error.message.includes("tournament_admins")) {
    return NextResponse.json({ error: delAdmins.error.message }, { status: 500 });
  }
  const adminRows = localAdminPlayerIds.map((playerId) => ({ tournament_id: tournamentId, player_id: playerId }));
  const insAdmins = await supabaseServer.from("tournament_admins").insert(adminRows);
  if (insAdmins.error && !insAdmins.error.message.includes("tournament_admins")) {
    return NextResponse.json({ error: insAdmins.error.message }, { status: 500 });
  }

  await writeAuditLog({
    actorUserId: admin.ctx.userId,
    actorPlayerId: admin.ctx.playerId,
    action: "tournament_update",
    targetType: "tournament",
    targetId: tournamentId,
    metadata: { started: started.started, playerCount: playerIds.length, localAdminCount: localAdminPlayerIds.length, isPrivate },
  });

  return NextResponse.json({ tournament: data, started: started.started });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await assertMainAdmin(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const { id: tournamentId } = await params;

  const { data: tournament, error: tErr } = await supabaseServer
    .from("tournaments")
    .select("id")
    .eq("id", tournamentId)
    .maybeSingle();

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!tournament) return NextResponse.json({ error: "tournament_not_found" }, { status: 404 });

  const { data: batches, error: bErr } = await supabaseServer
    .from("team_batches")
    .select("id")
    .eq("tournament_id", tournamentId);
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });

  const batchIds = (batches ?? []).map((b) => String(b.id));

  let teamIds: string[] = [];
  if (batchIds.length > 0) {
    const { data: teams, error: teamsErr } = await supabaseServer
      .from("teams")
      .select("id")
      .in("batch_id", batchIds);
    if (teamsErr) return NextResponse.json({ error: teamsErr.message }, { status: 500 });
    teamIds = (teams ?? []).map((t) => String(t.id));
  }

  const historyUnlink = await supabaseServer
    .from("player_mmr_history")
    .update({ tournament_id: null, match_id: null })
    .eq("tournament_id", tournamentId);
  if (historyUnlink.error && !isMissingOptionalRelation(historyUnlink.error.message)) {
    const historyDelete = await supabaseServer
      .from("player_mmr_history")
      .delete()
      .eq("tournament_id", tournamentId);
    if (historyDelete.error && !isMissingOptionalRelation(historyDelete.error.message)) {
      return NextResponse.json({ error: historyDelete.error.message }, { status: 500 });
    }
  }

  for (const table of [
    "tournament_round_schedules",
    "tournament_rules",
    "tournament_join_requests",
    "tournament_invites",
  ]) {
    const optionalErr = await deleteOptionalRows(table, tournamentId);
    if (optionalErr) return NextResponse.json({ error: optionalErr }, { status: 500 });
  }

  const { error: resultsErr } = await supabaseServer
    .from("tournament_results")
    .delete()
    .eq("tournament_id", tournamentId);
  if (resultsErr) return NextResponse.json({ error: resultsErr.message }, { status: 500 });

  const { error: matchesErr } = await supabaseServer
    .from("tournament_matches")
    .delete()
    .eq("tournament_id", tournamentId);
  if (matchesErr) return NextResponse.json({ error: matchesErr.message }, { status: 500 });

  const { error: tpErr } = await supabaseServer
    .from("tournament_players")
    .delete()
    .eq("tournament_id", tournamentId);
  if (tpErr) return NextResponse.json({ error: tpErr.message }, { status: 500 });

  const { error: adminLinksErr } = await supabaseServer
    .from("tournament_admins")
    .delete()
    .eq("tournament_id", tournamentId);
  if (adminLinksErr && !adminLinksErr.message.includes("tournament_admins")) {
    return NextResponse.json({ error: adminLinksErr.message }, { status: 500 });
  }

  if (teamIds.length > 0) {
    const { error: membersErr } = await supabaseServer
      .from("team_members")
      .delete()
      .in("team_id", teamIds);
    if (membersErr) return NextResponse.json({ error: membersErr.message }, { status: 500 });
  }

  if (batchIds.length > 0) {
    const { error: teamsDelErr } = await supabaseServer
      .from("teams")
      .delete()
      .in("batch_id", batchIds);
    if (teamsDelErr) return NextResponse.json({ error: teamsDelErr.message }, { status: 500 });
  }

  const { error: batchesErr } = await supabaseServer
    .from("team_batches")
    .delete()
    .eq("tournament_id", tournamentId);
  if (batchesErr) return NextResponse.json({ error: batchesErr.message }, { status: 500 });

  const { error: delTournamentErr } = await supabaseServer
    .from("tournaments")
    .delete()
    .eq("id", tournamentId);
  if (delTournamentErr) return NextResponse.json({ error: delTournamentErr.message }, { status: 500 });

  await writeAuditLog({
    actorUserId: admin.ctx.userId,
    actorPlayerId: admin.ctx.playerId,
    action: "tournament_delete",
    targetType: "tournament",
    targetId: tournamentId,
    metadata: { batchCount: batchIds.length, teamCount: teamIds.length },
  });

  return NextResponse.json({ deleted: true, tournamentId });
}
