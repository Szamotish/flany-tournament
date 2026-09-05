import { NextResponse } from "next/server";
import { assertMainAdmin } from "@/app/api/admin/_auth";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { recalculateRankedMmrForPlayer } from "@/lib/rankedRecalculate";
import { writeAuditLog } from "@/lib/auditLog";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ playerId: string }> }
) {
  const ip = clientIp(req);
  const ipLimit = rateLimit({ key: `ranked-recalculate-player:ip:${ip}`, limit: 30, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);

  const admin = await assertMainAdmin(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const userLimit = rateLimit({
    key: `ranked-recalculate-player:user:${admin.ctx.userId}`,
    limit: 20,
    windowMs: 60 * 60 * 1000,
  });
  if (!userLimit.ok) return rateLimitResponse(userLimit);

  const { playerId } = await params;
  if (!playerId) return NextResponse.json({ error: "missing_player_id" }, { status: 400 });

  try {
    const summary = await recalculateRankedMmrForPlayer(playerId);

    await writeAuditLog({
      actorUserId: admin.ctx.userId,
      actorPlayerId: admin.ctx.playerId,
      action: "ranked_mmr_recalculate_player",
      targetType: "player",
      targetId: playerId,
      metadata: summary,
    });

    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "ranked_recalculate_player_failed" },
      { status: 500 }
    );
  }
}
