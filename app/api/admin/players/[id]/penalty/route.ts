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
  const limit = rateLimit({ key: `ranked-penalty:${auth.ctx.userId}`, limit: 30, windowMs: 60 * 60 * 1000 });
  if (!limit.ok) return rateLimitResponse(limit);
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const points = body?.points;
  const penaltyId = body?.penaltyId;
  const note = body?.note;
  if (!UUID.test(id) || typeof penaltyId !== "string" || !UUID.test(penaltyId)) {
    return NextResponse.json({ error: "invalid_penalty_id" }, { status: 400 });
  }
  if (!Number.isInteger(points) || points < 1 || points > 100 || typeof note !== "string" || !note.trim() || note.length > 500) {
    return NextResponse.json({ error: "Podaj karę od 1 do 100 punktów i uzasadnienie do 500 znaków." }, { status: 400 });
  }
  let penaltySaved = false;
  try {
    // Freeze the original baseline before the first penalty, even without games.
    await recalculateRankedMmrForPlayer(id);
    const result = await supabaseServer.rpc("grant_ranked_penalty", {
      penalty_id: penaltyId, target_player_id: id, actor_player_id: auth.ctx.playerId,
      penalty_points: points, penalty_note: note.trim(),
    });
    if (result.error) throw new Error(result.error.message);
    penaltySaved = true;
    await recalculateRankedMmrForPlayer(id);
    await writeAuditLog({ actorUserId: auth.ctx.userId, actorPlayerId: auth.ctx.playerId,
      action: "player_ranked_penalty", targetType: "player", targetId: id,
      metadata: { penaltyId, points, note: note.trim() } });
    return NextResponse.json({ ok: true, penaltyId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ranked_penalty_failed";
    return NextResponse.json({ error: message, penaltySaved, penaltyId },
      { status: message === "player_not_found" ? 404 : message === "penalty_id_conflict" ? 409 : 503 });
  }
}
