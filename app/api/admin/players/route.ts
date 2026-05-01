import { NextResponse } from "next/server";
import { assertMainAdmin } from "@/app/api/admin/_auth";
import { writeAuditLog } from "@/lib/auditLog";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { supabaseServer } from "@/lib/supabaseServer";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const ipLimit = rateLimit({ key: `admin-player-create:ip:${ip}`, limit: 60, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);

  const admin = await assertMainAdmin(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }
  const userLimit = rateLimit({ key: `admin-player-create:user:${admin.ctx.userId}`, limit: 40, windowMs: 60 * 60 * 1000 });
  if (!userLimit.ok) return rateLimitResponse(userLimit);

  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? "").trim();

  if (!name) return NextResponse.json({ error: "missing_name" }, { status: 400 });
  if (name.length > 40) return NextResponse.json({ error: "name_too_long" }, { status: 400 });

  const { data, error } = await supabaseServer
    .from("players")
    .insert({ name, active: true })
    .select("id,name,active")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    actorUserId: admin.ctx.userId,
    actorPlayerId: admin.ctx.playerId,
    action: "player_create",
    targetType: "player",
    targetId: data.id,
    metadata: { name },
  });

  return NextResponse.json({ player: data });
}
