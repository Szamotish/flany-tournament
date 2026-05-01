import { NextResponse } from "next/server";
import { readAuthContext } from "@/app/api/admin/_auth";
import { writeAuditLog } from "@/lib/auditLog";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { supabaseServer } from "@/lib/supabaseServer";

export async function DELETE(req: Request) {
  const ip = clientIp(req);
  const ipLimit = rateLimit({ key: `account-delete:ip:${ip}`, limit: 10, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);

  const auth = await readAuthContext(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userLimit = rateLimit({ key: `account-delete:user:${auth.ctx.userId}`, limit: 3, windowMs: 60 * 60 * 1000 });
  if (!userLimit.ok) return rateLimitResponse(userLimit);

  if (auth.ctx.playerId) {
    const deactivatedName = `deleted-${auth.ctx.playerId.slice(0, 8)}`;
    const playerUpdatePrimary = await supabaseServer
      .from("players")
      .update({
        active: false,
        is_main_admin: false,
        auth_user_id: null,
        email_notifications_enabled: false,
        name: deactivatedName,
      })
      .eq("id", auth.ctx.playerId);

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
        .eq("id", auth.ctx.playerId);
      playerUpdateErr = fallbackUpdate.error;
    }

    if (playerUpdateErr) {
      return NextResponse.json({ error: playerUpdateErr.message }, { status: 500 });
    }
  }

  await writeAuditLog({
    actorUserId: auth.ctx.userId,
    actorPlayerId: auth.ctx.playerId,
    action: "account_delete_self",
    targetType: "player",
    targetId: auth.ctx.playerId,
  });

  const adminDelete = await supabaseServer.auth.admin.deleteUser(auth.ctx.userId);
  if (adminDelete.error) {
    return NextResponse.json({ error: adminDelete.error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
