import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { generateTeams } from "@/lib/teams";
import { assertTournamentAdmin } from "@/app/api/admin/tournaments/_auth";
import { writeAuditLog } from "@/lib/auditLog";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { loadPlayerPerformance } from "@/lib/playerPerformance";
import { isOneVsOneFormat, ONE_V_ONE_PLAYER_LIMIT } from "@/lib/tournamentFormat";

type TournamentPlayer = {
  id: string;
  name: string;
  active: boolean;
  participationStatus: "participant" | "spectator";
};

type TournamentPlayerListRow = {
  participation_status?: string | null;
  players?: unknown;
};

type StrengthPlayer = {
  id: string;
  name: string;
  strength: number;
};

function parseTournamentPlayer(value: unknown, participationStatus: unknown): TournamentPlayer | null {
  const source = Array.isArray(value) ? value[0] : value;
  if (!source || typeof source !== "object") return null;
  const player = source as { id?: unknown; name?: unknown; active?: unknown };
  if (
    typeof player.id !== "string" ||
    typeof player.name !== "string" ||
    typeof player.active !== "boolean"
  ) {
    return null;
  }
  return {
    id: player.id,
    name: player.name,
    active: player.active,
    participationStatus: participationStatus === "spectator" ? "spectator" : "participant",
  };
}

function shufflePlayers<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function buildRandomTeams(
  players: StrengthPlayer[],
  teamSize: number,
  allowUneven: boolean
): StrengthPlayer[][] {
  const shuffled = shufflePlayers(players);

  if (!allowUneven && shuffled.length % teamSize !== 0) {
    throw new Error("cannot_split_evenly");
  }

  const teams: StrengthPlayer[][] = [];
  for (let i = 0; i < shuffled.length; i += teamSize) {
    teams.push(shuffled.slice(i, i + teamSize));
  }

  if (allowUneven && teams.length > 1) {
    const last = teams[teams.length - 1];
    if (last.length > 0 && last.length < teamSize - 1) {
      const prev = teams[teams.length - 2];
      while (last.length < teamSize - 1 && prev.length > 0) {
        const moved = prev.pop();
        if (moved) last.unshift(moved);
      }
      if (prev.length === 0) teams.splice(teams.length - 2, 1);
    }
  }

  return teams.filter((team) => team.length > 0);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIp(req);
  const ipLimit = rateLimit({ key: `teams-generate:ip:${ip}`, limit: 50, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);

  const { id: tournamentId } = await params;

  const auth = await assertTournamentAdmin(req, tournamentId);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });
  }
  const userLimit = rateLimit({ key: `teams-generate:user:${auth.ctx.userId}`, limit: 25, windowMs: 60 * 60 * 1000 });
  if (!userLimit.ok) return rateLimitResponse(userLimit);

  const body = await req.json().catch(() => null);
  const teamSize = Number(body?.teamSize ?? 5);
  const splitInHalf = body?.splitInHalf === true;
  const allowUneven = body?.allowUneven !== false;
  const iterations = Number(body?.iterations ?? 500);
  const mode = (body?.mode === "overwrite" ? "overwrite" : "reset") as
    | "reset"
    | "overwrite";
  const generationMode = body?.generationMode === "full_random" ? "full_random" : "balanced";

  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 5000) {
    return NextResponse.json({ error: "invalid_iterations" }, { status: 400 });
  }

  const tournamentRes = await supabaseServer
    .from("tournaments")
    .select("format")
    .eq("id", tournamentId)
    .maybeSingle();

  if (tournamentRes.error) return NextResponse.json({ error: tournamentRes.error.message }, { status: 500 });

  const isOneVsOne = isOneVsOneFormat(tournamentRes.data?.format);
  if (!splitInHalf && (!Number.isInteger(teamSize) || teamSize < (isOneVsOne ? 1 : 2) || teamSize > 20)) {
    return NextResponse.json({ error: "invalid_teamSize" }, { status: 400 });
  }

  let tp: TournamentPlayerListRow[] | null = null;
  let tpErr: { message: string } | null = null;

  const primaryPlayers = await supabaseServer
    .from("tournament_players")
    .select("player_id,participation_status, players(id,name,active)")
    .eq("tournament_id", tournamentId);

  tp = primaryPlayers.data as TournamentPlayerListRow[] | null;
  tpErr = primaryPlayers.error;

  if (primaryPlayers.error && primaryPlayers.error.message.includes("participation_status")) {
    const fallbackPlayers = await supabaseServer
      .from("tournament_players")
      .select("player_id, players(id,name,active)")
      .eq("tournament_id", tournamentId);
    tp = (fallbackPlayers.data ?? []).map((row) => ({
      ...row,
      participation_status: "participant",
    })) as TournamentPlayerListRow[];
    tpErr = fallbackPlayers.error;
  }

  if (tpErr) return NextResponse.json({ error: tpErr.message }, { status: 500 });

  const players = (tp ?? [])
    .map((x) => parseTournamentPlayer((x as { players?: unknown }).players, x.participation_status))
    .filter((p): p is TournamentPlayer => Boolean(p && p.active && p.participationStatus !== "spectator"));

  if (players.length < 2) {
    return NextResponse.json({ error: "not_enough_players" }, { status: 400 });
  }
  if (isOneVsOne && players.length !== ONE_V_ONE_PLAYER_LIMIT) {
    return NextResponse.json({ error: "invalid_player_count_for_1v1" }, { status: 400 });
  }

  const effectiveSplitInHalf = !isOneVsOne && splitInHalf;
  const effectiveTeamSize = isOneVsOne ? 1 : effectiveSplitInHalf ? Math.ceil(players.length / 2) : teamSize;
  const effectiveAllowUneven = isOneVsOne ? false : effectiveSplitInHalf ? true : allowUneven;

  const ids = players.map((p) => p.id);
  const perfByPlayer = await loadPlayerPerformance(ids);

  const playersWithStrength: StrengthPlayer[] = players.map((p) => {
    const perf = perfByPlayer.get(p.id);
    const rating = perf?.rating ?? 5;
    const effectiveMmr = perf?.effectiveMmr ?? rating;
    const blendedStrength = (rating + effectiveMmr) / 2;
    return { id: p.id, name: p.name, strength: blendedStrength };
  });

  const { data: activeBatch } = await supabaseServer
    .from("team_batches")
    .select("id")
    .eq("tournament_id", tournamentId)
    .eq("is_active", true)
    .maybeSingle();

  if (activeBatch?.id) {
    if (mode === "overwrite") {
      const { error: delErr } = await supabaseServer
        .from("team_batches")
        .delete()
        .eq("id", activeBatch.id);

      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    } else {
      const { error: updErr } = await supabaseServer
        .from("team_batches")
        .update({ is_active: false })
        .eq("id", activeBatch.id);

      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    }
  }

  let teams: StrengthPlayer[][] = [];
  let score = 0;

  if (generationMode === "full_random") {
    try {
      teams = buildRandomTeams(playersWithStrength, effectiveTeamSize, effectiveAllowUneven);
    } catch (err) {
      if (err instanceof Error && err.message === "cannot_split_evenly") {
        return NextResponse.json({ error: "cannot_split_evenly" }, { status: 400 });
      }
      return NextResponse.json({ error: "failed_to_generate_random" }, { status: 500 });
    }
  } else {
    const generated = generateTeams(playersWithStrength, effectiveTeamSize, effectiveAllowUneven, iterations);
    teams = generated.teams;
    score = generated.score;
  }

  if (!teams || teams.length === 0) {
    return NextResponse.json({ error: "failed_to_generate" }, { status: 500 });
  }

  const { data: batch, error: bErr } = await supabaseServer
    .from("team_batches")
    .insert({
      tournament_id: tournamentId,
      team_size: effectiveTeamSize,
      allow_uneven: effectiveAllowUneven,
      iterations,
      is_active: true,
    })
    .select("id")
    .single();

  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });

  const batchId = String(batch.id);
  const teamInserts = teams.map((_, i) => ({
    batch_id: batchId,
    name: `Druzyna ${i + 1}`,
  }));

  const { data: teamRows, error: tErr } = await supabaseServer
    .from("teams")
    .insert(teamInserts)
    .select("id,name");

  if (tErr || !teamRows) {
    return NextResponse.json({ error: tErr?.message ?? "team_insert_failed" }, { status: 500 });
  }

  const members = teamRows.flatMap((t, i) =>
    teams[i].map((p) => ({ team_id: t.id, player_id: p.id }))
  );

  const { error: mErr } = await supabaseServer.from("team_members").insert(members);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  await writeAuditLog({
    actorUserId: auth.ctx.userId,
    actorPlayerId: auth.ctx.playerId,
    action: "teams_generate",
    targetType: "tournament",
    targetId: tournamentId,
    metadata: {
      batchId,
      teamSize: effectiveTeamSize,
      allowUneven: effectiveAllowUneven,
      iterations,
      generationMode,
      forcedOneVsOne: isOneVsOne,
      splitInHalf: effectiveSplitInHalf,
    },
  });

  return NextResponse.json({ batchId, score, generationMode, splitInHalf: effectiveSplitInHalf });
}
