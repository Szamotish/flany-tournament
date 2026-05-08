import { NextResponse } from "next/server";
import { assertMainAdmin } from "@/app/api/admin/_auth";
import { findActiveEmailBan, normalizeEmail } from "@/lib/bans";
import { writeAuditLog } from "@/lib/auditLog";
import { removeRatingsGivenByPlayer } from "@/lib/ratingsCleanup";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { supabaseServer } from "@/lib/supabaseServer";

function normalizeReason(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.slice(0, 500);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIp(req);
  const ipLimit = rateLimit({ key: `admin-player-ban:ip:${ip}`, limit: 30, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);

  const admin = await assertMainAdmin(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }
  const userLimit = rateLimit({ key: `admin-player-ban:user:${admin.ctx.userId}`, limit: 20, windowMs: 60 * 60 * 1000 });
  if (!userLimit.ok) return rateLimitResponse(userLimit);

  const body = await req.json().catch(() => null);
  const reason = normalizeReason(body?.reason);
  const { id: playerId } = await params;

  const { data: player, error: pErr } = await supabaseServer
    .from("players")
    .select("id,name,auth_user_id")
    .eq("id", playerId)
    .maybeSingle();

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!player) return NextResponse.json({ error: "player_not_found" }, { status: 404 });

  const authUserId = typeof player.auth_user_id === "string" ? player.auth_user_id : null;
  if (!authUserId) {
    return NextResponse.json({ error: "player_has_no_account" }, { status: 400 });
  }

  const authUser = await supabaseServer.auth.admin.getUserById(authUserId);
  if (authUser.error) {
    return NextResponse.json({ error: authUser.error.message }, { status: 500 });
  }

  const email = normalizeEmail(authUser.data.user?.email);
  if (!email) {
    return NextResponse.json({ error: "player_has_no_email" }, { status: 400 });
  }

  try {
    const activeBan = await findActiveEmailBan(email);
    if (!activeBan) {
      const banInsertPrimary = await supabaseServer.from("bans").insert({
        email_normalized: email,
        reason,
        created_by_player_id: admin.ctx.playerId,
        target_player_id: playerId,
      });

      if (
        banInsertPrimary.error &&
        (banInsertPrimary.error.message.includes("created_by_player_id") ||
          banInsertPrimary.error.message.includes("target_player_id"))
      ) {
        const banInsertFallback = await supabaseServer.from("bans").insert({
          email_normalized: email,
          reason,
        });
        if (banInsertFallback.error) {
          if (banInsertFallback.error.message.includes("bans")) {
            return NextResponse.json({ error: "missing_bans_schema" }, { status: 500 });
          }
          return NextResponse.json({ error: banInsertFallback.error.message }, { status: 500 });
        }
      } else if (banInsertPrimary.error) {
        if (banInsertPrimary.error.message.includes("bans")) {
          return NextResponse.json({ error: "missing_bans_schema" }, { status: 500 });
        }
        return NextResponse.json({ error: banInsertPrimary.error.message }, { status: 500 });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "ban_check_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

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

  const authDelete = await supabaseServer.auth.admin.deleteUser(authUserId);
  if (authDelete.error && !authDelete.error.message.toLowerCase().includes("not found")) {
    return NextResponse.json({ error: authDelete.error.message }, { status: 500 });
  }

  await writeAuditLog({
    actorUserId: admin.ctx.userId,
    actorPlayerId: admin.ctx.playerId,
    action: "player_ban",
    targetType: "player",
    targetId: playerId,
    metadata: { name: player.name, bannedEmail: email, reason },
  });

  return NextResponse.json({ banned: true, playerId, email });
}

