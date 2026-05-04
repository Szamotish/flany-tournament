import { NextResponse } from "next/server";
import { assertTournamentAdmin } from "@/app/api/admin/tournaments/_auth";
import { writeAuditLog } from "@/lib/auditLog";
import { supabaseServer } from "@/lib/supabaseServer";
import { DEFAULT_RULES_TEXT, readTournamentRules } from "@/lib/tournamentRules";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await assertTournamentAdmin(req, id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });
  const rules = await readTournamentRules(id);
  return NextResponse.json(rules);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await assertTournamentAdmin(req, id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });

  const body = await req.json().catch(() => null);
  const content = String(body?.content ?? "").trim().slice(0, 12000) || DEFAULT_RULES_TEXT;

  const { data, error } = await supabaseServer
    .from("tournament_rules")
    .upsert({ tournament_id: id, content, updated_at: new Date().toISOString() }, { onConflict: "tournament_id" })
    .select("tournament_id,content,updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    actorUserId: auth.ctx.userId,
    actorPlayerId: auth.ctx.playerId,
    action: "tournament_rules_update",
    targetType: "tournament",
    targetId: id,
    metadata: { length: content.length },
  });

  return NextResponse.json({ rules: data });
}
