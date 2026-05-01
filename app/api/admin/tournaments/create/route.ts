import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/auditLog";
import { supabaseServer } from "@/lib/supabaseServer";
import { assertMainAdmin } from "@/app/api/admin/_auth";
import { normalizeMode } from "@/lib/ranked";

export async function POST(req: Request) {
  const admin = await assertMainAdmin(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const body = await req.json().catch(() => null);

  const name = String(body?.name ?? "").trim();
  const format = body?.format === "double_elim" ? "double_elim" : "single_elim";
  const mode = normalizeMode(body?.mode);
  const boDefault = Number(body?.boDefault ?? 1);
  const boFinals = Number(body?.boFinals ?? 3);
  const gfResetEnabled = Boolean(body?.gfResetEnabled ?? false);
  const eventAtRaw = typeof body?.eventAt === "string" ? body.eventAt.trim() : "";
  const joinDeadlineAtRaw =
    typeof body?.joinDeadlineAt === "string" ? body.joinDeadlineAt.trim() : "";
  const eventLocation = typeof body?.eventLocation === "string" ? body.eventLocation.trim().slice(0, 140) : "";

  const playerIds: string[] = Array.isArray(body?.playerIds)
    ? Array.from(new Set(body.playerIds.map((value: unknown) => String(value)).filter(Boolean)))
    : [];
  const localAdminPlayerIdsRaw: string[] = Array.isArray(body?.localAdminPlayerIds)
    ? Array.from(new Set(body.localAdminPlayerIds.map((value: unknown) => String(value)).filter(Boolean)))
    : [];
  const localAdminPlayerIds: string[] = Array.from(
    new Set([...(localAdminPlayerIdsRaw ?? []), ...(admin.ctx.playerId ? [admin.ctx.playerId] : [])])
  );

  if (!name) return NextResponse.json({ error: "missing_name" }, { status: 400 });
  if (!["single_elim", "double_elim"].includes(format)) {
    return NextResponse.json({ error: "invalid_format" }, { status: 400 });
  }
  if (![1, 3, 5].includes(boDefault)) {
    return NextResponse.json({ error: "invalid_boDefault" }, { status: 400 });
  }
  if (![1, 3, 5].includes(boFinals)) {
    return NextResponse.json({ error: "invalid_boFinals" }, { status: 400 });
  }
  if (!Array.isArray(playerIds) || playerIds.length < 2) {
    return NextResponse.json({ error: "invalid_playerIds" }, { status: 400 });
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

  const { data: selectedPlayers, error: selectedPlayersErr } = await supabaseServer
    .from("players")
    .select("id,auth_user_id,active")
    .in("id", playerIds);

  if (selectedPlayersErr) {
    if (selectedPlayersErr.message.includes("auth_user_id")) {
      return NextResponse.json({ error: "missing_auth_schema" }, { status: 500 });
    }
    return NextResponse.json({ error: selectedPlayersErr.message }, { status: 500 });
  }

  const selectedPlayersSet = new Set((selectedPlayers ?? []).map((row) => String(row.id)));
  const inactiveSelected = (selectedPlayers ?? []).filter((row) => row.active !== true);

  if (selectedPlayersSet.size !== playerIds.length) {
    return NextResponse.json({ error: "some_players_not_found" }, { status: 400 });
  }
  if (inactiveSelected.length > 0) {
    return NextResponse.json({ error: "selected_player_inactive" }, { status: 400 });
  }

  const { data: localAdmins, error: localAdminsErr } = await supabaseServer
    .from("players")
    .select("id,auth_user_id,active")
    .in("id", localAdminPlayerIds);

  if (localAdminsErr) {
    if (localAdminsErr.message.includes("auth_user_id")) {
      return NextResponse.json({ error: "missing_auth_schema" }, { status: 500 });
    }
    return NextResponse.json({ error: localAdminsErr.message }, { status: 500 });
  }

  const localAdminsSet = new Set((localAdmins ?? []).map((row) => String(row.id)));
  if (localAdminsSet.size !== localAdminPlayerIds.length) {
    return NextResponse.json({ error: "some_local_admins_not_found" }, { status: 400 });
  }

  const invalidLocalAdmins = (localAdmins ?? []).filter(
    (row) => row.active !== true || row.auth_user_id === null
  );
  if (invalidLocalAdmins.length > 0) {
    return NextResponse.json(
      { error: "local_admin_requires_active_account", ids: invalidLocalAdmins.map((row) => row.id) },
      { status: 400 }
    );
  }

  const tournamentInsert = {
    name,
    format,
    mode,
    bo_default: boDefault,
    bo_finals: boFinals,
    gf_reset_enabled: format === "double_elim" ? gfResetEnabled : false,
    event_at: eventAt ? eventAt.toISOString() : null,
    event_location: eventLocation || null,
    join_deadline_at: joinDeadlineAt ? joinDeadlineAt.toISOString() : null,
  };
  const legacyTournamentInsert = {
    name,
    format,
    mode,
    bo_default: boDefault,
    bo_finals: boFinals,
    gf_reset_enabled: format === "double_elim" ? gfResetEnabled : false,
  };

  let t = null as { id: string } | null;
  let tErr: { message: string } | null = null;

  const insertPrimary = await supabaseServer
    .from("tournaments")
    .insert(tournamentInsert)
    .select("id")
    .single();

  t = insertPrimary.data;
  tErr = insertPrimary.error;

  if (
    insertPrimary.error &&
    (insertPrimary.error.message.includes("event_at") ||
      insertPrimary.error.message.includes("event_location") ||
      insertPrimary.error.message.includes("join_deadline_at"))
  ) {
    const retryLegacy = await supabaseServer
      .from("tournaments")
      .insert(legacyTournamentInsert)
      .select("id")
      .single();
    t = retryLegacy.data;
    tErr = retryLegacy.error;
  }

  if (tErr && tErr.message.includes("local_admin_password")) {
    const insertLegacy = await supabaseServer
      .from("tournaments")
      .insert({ ...legacyTournamentInsert, local_admin_password: crypto.randomUUID() })
      .select("id")
      .single();

    t = insertLegacy.data;
    tErr = insertLegacy.error;
  }

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!t?.id) return NextResponse.json({ error: "tournament_create_failed" }, { status: 500 });

  const tournamentId = t.id;

  const rows = playerIds.map((id: string) => ({ tournament_id: tournamentId, player_id: id }));
  const { error: pErr } = await supabaseServer.from("tournament_players").insert(rows);

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const adminRows = localAdminPlayerIds.map((playerId) => ({
    tournament_id: tournamentId,
    player_id: playerId,
  }));

  const { error: adminErr } = await supabaseServer.from("tournament_admins").insert(adminRows);

  if (adminErr) {
    if (adminErr.message.includes("tournament_admins")) {
      return NextResponse.json({ error: "missing_tournament_admins_schema" }, { status: 500 });
    }
    return NextResponse.json({ error: adminErr.message }, { status: 500 });
  }

  await writeAuditLog({
    actorUserId: admin.ctx.userId,
    actorPlayerId: admin.ctx.playerId,
    action: "tournament_create",
    targetType: "tournament",
    targetId: tournamentId,
    metadata: {
      mode,
      format,
      playerCount: playerIds.length,
      localAdminCount: localAdminPlayerIds.length,
    },
  });

  return NextResponse.json({ tournamentId });
}
