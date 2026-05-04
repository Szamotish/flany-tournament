import { NextResponse } from "next/server";
import { assertMainAdmin } from "@/app/api/admin/_auth";
import { writeAuditLog } from "@/lib/auditLog";
import { supabaseServer } from "@/lib/supabaseServer";
import { DEFAULT_RULES_TEXT, readDefaultRules } from "@/lib/tournamentRules";

export async function GET(req: Request) {
  const admin = await assertMainAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });
  return NextResponse.json({ content: await readDefaultRules() });
}

export async function PATCH(req: Request) {
  const admin = await assertMainAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const body = await req.json().catch(() => null);
  const content = String(body?.content ?? "").trim().slice(0, 12000) || DEFAULT_RULES_TEXT;

  const { data, error } = await supabaseServer
    .from("rule_templates")
    .upsert({ id: "default", content, updated_at: new Date().toISOString() }, { onConflict: "id" })
    .select("id,content,updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    actorUserId: admin.ctx.userId,
    actorPlayerId: admin.ctx.playerId,
    action: "rules_template_update",
    targetType: "rules_template",
    targetId: "default",
    metadata: { length: content.length },
  });

  return NextResponse.json({ template: data });
}
