import { NextResponse } from "next/server";
import { assertMainAdmin } from "@/app/api/admin/_auth";
import { supabaseServer } from "@/lib/supabaseServer";
import { recalculateRankedMmrForPlayer } from "@/lib/rankedRecalculate";
import { rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { writeAuditLog } from "@/lib/auditLog";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await assertMainAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const limit = rateLimit({ key: `performance-bonus:${auth.ctx.userId}`, limit: 30, windowMs: 60 * 60 * 1000 });
  if (!limit.ok) return rateLimitResponse(limit);
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const delta = body?.delta;
  const bonusId = body?.bonusId;
  const note = body?.note ?? "";
  if (!UUID.test(id) || typeof bonusId !== "string" || !UUID.test(bonusId)) {
    return NextResponse.json({ error: "invalid_bonus_id" }, { status: 400 });
  }
  if (typeof delta !== "number" || !Number.isFinite(delta) || delta < 0.1 || delta > 10 ||
    Math.abs(delta * 10 - Math.round(delta * 10)) > 1e-8 || typeof note !== "string" || note.length > 500) {
    return NextResponse.json({ error: "Podaj bonus od 0,1 do 10 MMR, co 0,1, i uzasadnienie do 500 znaków." }, { status: 400 });
  }
  let bonusSaved = false;
  try {
    // Freeze the pre-bonus baseline, including for players with no ranked games yet.
    await recalculateRankedMmrForPlayer(id);
    const grant = await supabaseServer.rpc("grant_performance_bonus", {
      bonus_id: bonusId, target_player_id: id, actor_player_id: auth.ctx.playerId,
      bonus_delta: delta, bonus_note: note.trim(),
    });
    if (grant.error) throw new Error(grant.error.message);
    bonusSaved = true;
    await recalculateRankedMmrForPlayer(id);
    await writeAuditLog({
      actorUserId: auth.ctx.userId, actorPlayerId: auth.ctx.playerId, action: "player_performance_bonus",
      targetType: "player", targetId: id, metadata: { bonusId, delta, note: note.trim() },
    });
    return NextResponse.json({ ok: true, bonusId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "performance_bonus_failed";
    return NextResponse.json({ error: message, bonusSaved, bonusId }, { status: message === "player_not_found" ? 404 : 503 });
  }
}
