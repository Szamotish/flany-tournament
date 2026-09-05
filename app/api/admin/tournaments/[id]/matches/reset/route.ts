import { NextResponse } from "next/server";
import { assertTournamentAdmin } from "@/app/api/admin/tournaments/_auth";
import { writeAuditLog } from "@/lib/auditLog";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { normalizeMode } from "@/lib/ranked";
import { recalculateRankedMmr } from "@/lib/rankedRecalculate";
import { supabaseServer } from "@/lib/supabaseServer";

function isMissingOptionalRelation(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("does not exist") || normalized.includes("schema cache") || normalized.includes("could not find");
}

async function deleteOptionalTournamentRows(table: string, tournamentId: string): Promise<void> {
  const { error } = await supabaseServer.from(table).delete().eq("tournament_id", tournamentId);
  if (error && !isMissingOptionalRelation(error.message)) {
    throw new Error(`${table}_delete_failed: ${error.message}`);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIp(req);
  const ipLimit = rateLimit({ key: `tournament-reset:ip:${ip}`, limit: 20, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);

  const { id: tournamentId } = await params;
  const auth = await assertTournamentAdmin(req, tournamentId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });

  const userLimit = rateLimit({
    key: `tournament-reset:user:${auth.ctx.userId}`,
    limit: 10,
    windowMs: 60 * 60 * 1000,
  });
  if (!userLimit.ok) return rateLimitResponse(userLimit);

  try {
    const { data: tournament, error: tournamentErr } = await supabaseServer
      .from("tournaments")
      .select("id,mode,started_at")
      .eq("id", tournamentId)
      .maybeSingle();

    if (tournamentErr) throw new Error(`tournament_read_failed: ${tournamentErr.message}`);
    if (!tournament) return NextResponse.json({ error: "tournament_not_found" }, { status: 404 });

    const matchesCount = await supabaseServer
      .from("tournament_matches")
      .select("*", { count: "exact", head: true })
      .eq("tournament_id", tournamentId);

    if (matchesCount.error) throw new Error(`matches_count_failed: ${matchesCount.error.message}`);
    const hadMatches = (matchesCount.count ?? 0) > 0;

    const historyDelete = await supabaseServer
      .from("player_mmr_history")
      .delete()
      .eq("tournament_id", tournamentId)
      .in("reason", ["match_win", "match_loss", "tournament_win"]);

    if (historyDelete.error && !isMissingOptionalRelation(historyDelete.error.message)) {
      throw new Error(`ranked_history_delete_failed: ${historyDelete.error.message}`);
    }

    const resultsDelete = await supabaseServer
      .from("tournament_results")
      .delete()
      .eq("tournament_id", tournamentId);

    if (resultsDelete.error) throw new Error(`results_delete_failed: ${resultsDelete.error.message}`);

    await deleteOptionalTournamentRows("tournament_round_schedules", tournamentId);

    const matchesDelete = await supabaseServer
      .from("tournament_matches")
      .delete()
      .eq("tournament_id", tournamentId);

    if (matchesDelete.error) throw new Error(`matches_delete_failed: ${matchesDelete.error.message}`);

    const startedReset = await supabaseServer
      .from("tournaments")
      .update({ started_at: null })
      .eq("id", tournamentId);

    if (startedReset.error && !startedReset.error.message.includes("started_at")) {
      throw new Error(`started_at_reset_failed: ${startedReset.error.message}`);
    }

    let rankedRecalculateSummary: Awaited<ReturnType<typeof recalculateRankedMmr>> | null = null;
    if (normalizeMode(tournament.mode) === "ranked") {
      rankedRecalculateSummary = await recalculateRankedMmr();
    }

    await writeAuditLog({
      actorUserId: auth.ctx.userId,
      actorPlayerId: auth.ctx.playerId,
      action: "tournament_reset",
      targetType: "tournament",
      targetId: tournamentId,
      metadata: {
        hadMatches,
        wasStarted: Boolean(tournament.started_at),
        rankedRecalculateSummary,
      },
    });

    return NextResponse.json({
      reset: true,
      tournamentId,
      hadMatches,
      rankedRecalculateSummary,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "tournament_reset_failed" },
      { status: 500 }
    );
  }
}
