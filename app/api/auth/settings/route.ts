import { NextResponse } from "next/server";
import { readAuthContext } from "@/app/api/admin/_auth";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(req: Request) {
  const auth = await readAuthContext(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.ctx.playerId) return NextResponse.json({ error: "missing_player_profile" }, { status: 403 });

  const { data, error } = await supabaseServer
    .from("players")
    .select("email_notifications_enabled")
    .eq("id", auth.ctx.playerId)
    .maybeSingle();

  if (error) {
    if (error.message.includes("email_notifications_enabled")) {
      return NextResponse.json({ error: "missing_settings_schema" }, { status: 500 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    emailNotificationsEnabled: data?.email_notifications_enabled === true,
  });
}

export async function PATCH(req: Request) {
  const auth = await readAuthContext(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.ctx.playerId) return NextResponse.json({ error: "missing_player_profile" }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (typeof body?.emailNotificationsEnabled !== "boolean") {
    return NextResponse.json({ error: "invalid_email_notifications_enabled" }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("players")
    .update({
      email_notifications_enabled: body.emailNotificationsEnabled,
    })
    .eq("id", auth.ctx.playerId)
    .select("id,email_notifications_enabled")
    .single();

  if (error) {
    if (error.message.includes("email_notifications_enabled")) {
      return NextResponse.json({ error: "missing_settings_schema" }, { status: 500 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    playerId: data.id,
    emailNotificationsEnabled: data.email_notifications_enabled === true,
  });
}
