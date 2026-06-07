import { NextResponse } from "next/server";
import { assertMainAdmin } from "@/app/api/admin/_auth";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { recalculateRankedMmr } from "@/lib/rankedRecalculate";
import { writeAuditLog } from "@/lib/auditLog";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const ipLimit = rateLimit({ key: `ranked-recalculate:ip:${ip}`, limit: 10, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);

  const admin = await assertMainAdmin(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const userLimit = rateLimit({
    key: `ranked-recalculate:user:${admin.ctx.userId}`,
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!userLimit.ok) return rateLimitResponse(userLimit);

  try {
    const summary = await recalculateRankedMmr();

    await writeAuditLog({
      actorUserId: admin.ctx.userId,
      actorPlayerId: admin.ctx.playerId,
      action: "ranked_mmr_recalculate",
      targetType: "ranked_mmr",
      targetId: null,
      metadata: summary,
    });

    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "ranked_recalculate_failed" },
      { status: 500 }
    );
  }
}
