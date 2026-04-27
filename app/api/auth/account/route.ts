import { NextResponse } from "next/server";
import { readAuthContext } from "@/app/api/admin/_auth";
import { supabaseServer } from "@/lib/supabaseServer";

export async function DELETE(req: Request) {
  const auth = await readAuthContext(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

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

  const adminDelete = await supabaseServer.auth.admin.deleteUser(auth.ctx.userId);
  if (adminDelete.error) {
    return NextResponse.json({ error: adminDelete.error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
