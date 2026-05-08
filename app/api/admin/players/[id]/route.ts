import { NextResponse } from "next/server";
import { assertMainAdmin } from "@/app/api/admin/_auth";
import { writeAuditLog } from "@/lib/auditLog";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { removeRatingsGivenByPlayer } from "@/lib/ratingsCleanup";
import { supabaseServer } from "@/lib/supabaseServer";
import { BASE_MMR_CAP } from "@/lib/ranked";

function roundToOne(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function clampMmr(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > BASE_MMR_CAP) return BASE_MMR_CAP;
  return roundToOne(value);
}

function clampRating(value: number): number {
  if (!Number.isFinite(value)) return 1;
  if (value < 1) return 1;
  if (value > 10) return 10;
  return roundToOne(value);
}

function clampPrestigePoints(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 9999) return 9999;
  return Math.floor(value);
}

async function writeMmrHistoryEntry(
  playerId: string,
  mmr: number | null | undefined,
  prestigePoints: number | null | undefined,
  reason: "admin_set_mmr" | "admin_reset_mmr"
) {
  if (!Number.isFinite(Number(mmr))) return;
  const insert = await supabaseServer.from("player_mmr_history").insert({
    player_id: playerId,
    reason,
    delta: null,
    mmr: roundToOne(Number(mmr)),
    prestige_points: Number.isFinite(Number(prestigePoints)) ? Number(prestigePoints) : 0,
  });
  if (insert.error && !insert.error.message.includes("player_mmr_history")) {
    throw new Error(insert.error.message);
  }
}

async function clearMmrHistory(playerId: string) {
  const del = await supabaseServer.from("player_mmr_history").delete().eq("player_id", playerId);
  if (del.error && !del.error.message.includes("player_mmr_history")) {
    throw new Error(del.error.message);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIp(req);
  const ipLimit = rateLimit({ key: `admin-player-update:ip:${ip}`, limit: 120, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);

  const admin = await assertMainAdmin(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }
  const userLimit = rateLimit({ key: `admin-player-update:user:${admin.ctx.userId}`, limit: 80, windowMs: 60 * 60 * 1000 });
  if (!userLimit.ok) return rateLimitResponse(userLimit);

  const { id: playerId } = await params;

  const body = await req.json().catch(() => null);
  const hasName = typeof body?.name === "string";
  const name = hasName ? String(body?.name ?? "").trim() : "";
  const hasMmr = body && Object.prototype.hasOwnProperty.call(body, "mmr");
  const hasRatingOverride = body && Object.prototype.hasOwnProperty.call(body, "ratingOverride");
  const hasPrestigePoints = body && Object.prototype.hasOwnProperty.call(body, "prestigePoints");
  const hasCanRateOthers = body && Object.prototype.hasOwnProperty.call(body, "canRateOthers");
  const resetMmr = body?.resetMmr === true;

  if (hasName && !name) return NextResponse.json({ error: "missing_name" }, { status: 400 });
  if (hasName && name.length > 40) return NextResponse.json({ error: "name_too_long" }, { status: 400 });
  if (!hasName && !hasMmr && !hasRatingOverride && !hasPrestigePoints && !hasCanRateOthers && !resetMmr) {
    return NextResponse.json({ error: "missing_update_fields" }, { status: 400 });
  }

  let normalizedMmr: number | null = null;
  let normalizedRatingOverride: number | null = null;
  let normalizedPrestigePoints: number | null = null;
  let normalizedCanRateOthers: boolean | null = null;
  if (hasMmr) {
    const numericMmr = Number(body?.mmr);
    if (!Number.isFinite(numericMmr)) {
      return NextResponse.json({ error: "invalid_mmr" }, { status: 400 });
    }
    normalizedMmr = clampMmr(numericMmr);
  }
  if (hasRatingOverride && body?.ratingOverride !== null) {
    const numericRating = Number(body?.ratingOverride);
    if (!Number.isFinite(numericRating)) {
      return NextResponse.json({ error: "invalid_rating" }, { status: 400 });
    }
    normalizedRatingOverride = clampRating(numericRating);
  }
  if (hasPrestigePoints) {
    const numericPrestige = Number(body?.prestigePoints);
    if (!Number.isFinite(numericPrestige)) {
      return NextResponse.json({ error: "invalid_prestige_points" }, { status: 400 });
    }
    normalizedPrestigePoints = clampPrestigePoints(numericPrestige);
  }
  if (hasCanRateOthers) {
    if (typeof body?.canRateOthers !== "boolean") {
      return NextResponse.json({ error: "invalid_can_rate_others" }, { status: 400 });
    }
    normalizedCanRateOthers = body.canRateOthers;
  }

  const { data: player, error: pErr } = await supabaseServer
    .from("players")
    .select("id")
    .eq("id", playerId)
    .maybeSingle();

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!player) return NextResponse.json({ error: "player_not_found" }, { status: 404 });

  const updatePayload: {
    name?: string;
    mmr?: number;
    prestige_points?: number;
    rating_override?: number | null;
    mmr_manual_override?: boolean;
    can_rate_others?: boolean;
  } = {};
  if (hasName) updatePayload.name = name;
  if (resetMmr) {
    updatePayload.mmr = 0;
    updatePayload.prestige_points = 0;
    updatePayload.mmr_manual_override = false;
  } else if (hasMmr && normalizedMmr !== null) {
    updatePayload.mmr = normalizedMmr;
    updatePayload.mmr_manual_override = true;
  }
  if (hasPrestigePoints && normalizedPrestigePoints !== null) {
    updatePayload.prestige_points = normalizedPrestigePoints;
    updatePayload.mmr_manual_override = true;
  }
  if (hasRatingOverride) {
    updatePayload.rating_override = normalizedRatingOverride;
  }
  if (hasCanRateOthers && normalizedCanRateOthers !== null) {
    updatePayload.can_rate_others = normalizedCanRateOthers;
  }

  const primaryUpdate = await supabaseServer
    .from("players")
    .update(updatePayload)
    .eq("id", playerId)
    .select("id,name,active,mmr,prestige_points,rating_override,mmr_manual_override,rank_frame_enabled,can_rate_others")
    .single();

  if (
    primaryUpdate.error &&
    (primaryUpdate.error.message.includes("mmr_manual_override") ||
      primaryUpdate.error.message.includes("rating_override") ||
      primaryUpdate.error.message.includes("rank_frame_enabled") ||
      primaryUpdate.error.message.includes("can_rate_others"))
  ) {
    const fallbackUpdatePayload = { ...updatePayload };
    delete fallbackUpdatePayload.mmr_manual_override;
    delete fallbackUpdatePayload.rating_override;
    delete fallbackUpdatePayload.can_rate_others;

    const retry = await supabaseServer
      .from("players")
      .update(fallbackUpdatePayload)
      .eq("id", playerId)
      .select("id,name,active,mmr,prestige_points")
      .single();

    if (retry.error) return NextResponse.json({ error: retry.error.message }, { status: 500 });
    if (hasMmr || hasPrestigePoints || resetMmr) {
      try {
        if (resetMmr) {
          await clearMmrHistory(playerId);
        }
        await writeMmrHistoryEntry(
          playerId,
          (retry.data as { mmr?: number | null }).mmr ?? null,
          resetMmr ? 0 : null,
          resetMmr ? "admin_reset_mmr" : "admin_set_mmr"
        );
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "mmr_history_write_failed" },
          { status: 500 }
        );
      }
    }
    await writeAuditLog({
      actorUserId: admin.ctx.userId,
      actorPlayerId: admin.ctx.playerId,
      action: resetMmr
        ? "player_mmr_reset"
        : hasMmr || hasPrestigePoints
          ? "player_rank_values_set"
          : hasRatingOverride
            ? "player_rating_override_set"
            : hasCanRateOthers
              ? "player_rating_permission_set"
            : "player_update",
      targetType: "player",
      targetId: playerId,
      metadata: { hasName, hasMmr, hasRatingOverride, hasPrestigePoints, hasCanRateOthers, resetMmr },
    });
    return NextResponse.json({ player: retry.data });
  }

  if (primaryUpdate.error) return NextResponse.json({ error: primaryUpdate.error.message }, { status: 500 });

  if (hasMmr || hasPrestigePoints || resetMmr) {
    const row = primaryUpdate.data as { mmr?: number | null; prestige_points?: number | null };
    try {
      if (resetMmr) {
        await clearMmrHistory(playerId);
      }
      await writeMmrHistoryEntry(
        playerId,
        row.mmr ?? null,
        row.prestige_points ?? null,
        resetMmr ? "admin_reset_mmr" : "admin_set_mmr"
      );
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "mmr_history_write_failed" },
        { status: 500 }
      );
    }
  }

  await writeAuditLog({
    actorUserId: admin.ctx.userId,
    actorPlayerId: admin.ctx.playerId,
    action: resetMmr
      ? "player_mmr_reset"
    : hasMmr || hasPrestigePoints
      ? "player_rank_values_set"
      : hasRatingOverride
        ? "player_rating_override_set"
        : hasCanRateOthers
          ? "player_rating_permission_set"
        : "player_update",
    targetType: "player",
    targetId: playerId,
    metadata: { hasName, hasMmr, hasRatingOverride, hasPrestigePoints, hasCanRateOthers, resetMmr },
  });

  return NextResponse.json({ player: primaryUpdate.data });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIp(req);
  const ipLimit = rateLimit({ key: `admin-player-delete:ip:${ip}`, limit: 30, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);

  const admin = await assertMainAdmin(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }
  const userLimit = rateLimit({ key: `admin-player-delete:user:${admin.ctx.userId}`, limit: 20, windowMs: 60 * 60 * 1000 });
  if (!userLimit.ok) return rateLimitResponse(userLimit);

  const { id: playerId } = await params;

  const { data: player, error: pErr } = await supabaseServer
    .from("players")
    .select("id,name,auth_user_id")
    .eq("id", playerId)
    .maybeSingle();

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!player) return NextResponse.json({ error: "player_not_found" }, { status: 404 });

  const { error: taErr } = await supabaseServer
    .from("tournament_admins")
    .delete()
    .eq("player_id", playerId);
  if (taErr && !taErr.message.includes("tournament_admins")) {
    return NextResponse.json({ error: taErr.message }, { status: 500 });
  }
  try {
    await removeRatingsGivenByPlayer(playerId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ratings_cleanup_failed" },
      { status: 500 }
    );
  }

  const deactivatedName = `deleted-${playerId.slice(0, 8)}-${Date.now().toString(36)}`;

  const playerUpdatePrimary = await supabaseServer
    .from("players")
    .update({
      active: false,
      is_main_admin: false,
      auth_user_id: null,
      email_notifications_enabled: false,
      name: deactivatedName,
    })
    .eq("id", playerId);

  let playerUpdateErr = playerUpdatePrimary.error;
  if (playerUpdatePrimary.error && playerUpdatePrimary.error.message.includes("email_notifications_enabled")) {
    const fallbackUpdate = await supabaseServer
      .from("players")
      .update({
        active: false,
        is_main_admin: false,
        auth_user_id: null,
        name: deactivatedName,
      })
      .eq("id", playerId);
    playerUpdateErr = fallbackUpdate.error;
  }
  if (playerUpdateErr) return NextResponse.json({ error: playerUpdateErr.message }, { status: 500 });

  const authUserId = typeof player.auth_user_id === "string" ? player.auth_user_id : null;
  if (authUserId) {
    const authDelete = await supabaseServer.auth.admin.deleteUser(authUserId);
    if (authDelete.error && !authDelete.error.message.toLowerCase().includes("not found")) {
      return NextResponse.json({ error: authDelete.error.message }, { status: 500 });
    }
  }

  await writeAuditLog({
    actorUserId: admin.ctx.userId,
    actorPlayerId: admin.ctx.playerId,
    action: "player_delete",
    targetType: "player",
    targetId: playerId,
    metadata: { name: player.name, hadAccount: Boolean(authUserId) },
  });

  return NextResponse.json({ deleted: true, softDeleted: true, playerId });
}
