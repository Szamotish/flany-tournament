import { NextResponse } from "next/server";
import { assertTournamentAdmin } from "@/app/api/admin/tournaments/_auth";
import { writeAuditLog } from "@/lib/auditLog";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { supabaseServer } from "@/lib/supabaseServer";

async function hasTournamentStarted(tournamentId: string): Promise<boolean> {
  const { count } = await supabaseServer
    .from("tournament_matches")
    .select("*", { count: "exact", head: true })
    .eq("tournament_id", tournamentId);
  return (count ?? 0) > 0;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIp(req);
  const ipLimit = rateLimit({ key: `teams-swap:ip:${ip}`, limit: 120, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);

  const { id: tournamentId } = await params;
  const auth = await assertTournamentAdmin(req, tournamentId);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });
  }
  const userLimit = rateLimit({ key: `teams-swap:user:${auth.ctx.userId}`, limit: 80, windowMs: 60 * 60 * 1000 });
  if (!userLimit.ok) return rateLimitResponse(userLimit);

  if (await hasTournamentStarted(tournamentId)) {
    return NextResponse.json({ error: "tournament_already_started" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const playerAId = typeof body?.playerAId === "string" ? body.playerAId : "";
  const playerBId = typeof body?.playerBId === "string" ? body.playerBId : "";

  if (!playerAId || !playerBId || playerAId === playerBId) {
    return NextResponse.json({ error: "invalid_players" }, { status: 400 });
  }

  const activeBatchRes = await supabaseServer
    .from("team_batches")
    .select("id")
    .eq("tournament_id", tournamentId)
    .eq("is_active", true)
    .maybeSingle();

  if (activeBatchRes.error) {
    return NextResponse.json({ error: activeBatchRes.error.message }, { status: 500 });
  }
  if (!activeBatchRes.data?.id) {
    return NextResponse.json({ error: "active_batch_not_found" }, { status: 404 });
  }

  const teamsRes = await supabaseServer
    .from("teams")
    .select("id")
    .eq("batch_id", activeBatchRes.data.id);

  if (teamsRes.error) {
    return NextResponse.json({ error: teamsRes.error.message }, { status: 500 });
  }

  const activeTeamIds = (teamsRes.data ?? []).map((row) => String(row.id));
  if (activeTeamIds.length === 0) {
    return NextResponse.json({ error: "no_active_teams" }, { status: 400 });
  }

  const membersRes = await supabaseServer
    .from("team_members")
    .select("team_id,player_id")
    .in("team_id", activeTeamIds)
    .in("player_id", [playerAId, playerBId]);

  if (membersRes.error) {
    return NextResponse.json({ error: membersRes.error.message }, { status: 500 });
  }

  const memberA = (membersRes.data ?? []).find((row) => String(row.player_id) === playerAId);
  const memberB = (membersRes.data ?? []).find((row) => String(row.player_id) === playerBId);

  if (!memberA || !memberB) {
    return NextResponse.json({ error: "players_not_in_active_teams" }, { status: 400 });
  }

  const teamA = String(memberA.team_id);
  const teamB = String(memberB.team_id);
  if (teamA === teamB) {
    return NextResponse.json({ error: "players_in_same_team" }, { status: 400 });
  }

  const [updA, updB] = await Promise.all([
    supabaseServer
      .from("team_members")
      .update({ team_id: teamB })
      .eq("team_id", teamA)
      .eq("player_id", playerAId),
    supabaseServer
      .from("team_members")
      .update({ team_id: teamA })
      .eq("team_id", teamB)
      .eq("player_id", playerBId),
  ]);

  if (updA.error) return NextResponse.json({ error: updA.error.message }, { status: 500 });
  if (updB.error) return NextResponse.json({ error: updB.error.message }, { status: 500 });

  await writeAuditLog({
    actorUserId: auth.ctx.userId,
    actorPlayerId: auth.ctx.playerId,
    action: "teams_swap_players",
    targetType: "tournament",
    targetId: tournamentId,
    metadata: { playerAId, playerBId, teamA, teamB },
  });

  return NextResponse.json({
    swapped: true,
    from: { playerAId, teamId: teamA },
    to: { playerBId, teamId: teamB },
  });
}
