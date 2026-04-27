import { NextResponse } from "next/server";
import { supabasePublic } from "@/lib/supabasePublic";
import { computeBeersFromFinishedMatches } from "@/lib/beers";

export const dynamic = "force-dynamic";

type Bracket = "single" | "winners" | "losers" | "grand_final";
type TeamRef = { id: string; name: string };
type MatchView = {
  id: string;
  bracket: Bracket;
  roundNo: number;
  matchNo: number;
  bo: number;
  status: string;
  scoreA: number | null;
  scoreB: number | null;
  winnerTeamId: string | null;
  teamAId: string | null;
  teamBId: string | null;
  teamA: TeamRef | null;
  teamB: TeamRef | null;
  scheduledAt: string | null;
  scheduledLocation: string | null;
};

function parseTeamRef(value: unknown): TeamRef | null {
  const source = Array.isArray(value) ? value[0] : value;
  if (!source || typeof source !== "object") return null;
  const team = source as { id?: unknown; name?: unknown };
  if (typeof team.id !== "string" || typeof team.name !== "string") return null;
  return { id: team.id, name: team.name };
}

function parseBracket(value: unknown): Bracket {
  if (value === "winners" || value === "losers" || value === "grand_final") return value;
  return "single";
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tournamentId } = await params;

  const { data, error } = await supabasePublic
    .from("tournament_matches")
    .select(
      `
      id,
      tournament_id,
      bracket,
      round_no,
      match_no,
      bo,
      status,
      score_a,
      score_b,
      winner_team_id,
      team_a_id,
      team_b_id,
      team_a:team_a_id (id,name),
      team_b:team_b_id (id,name)
    `
    )
    .eq("tournament_id", tournamentId)
    .order("bracket", { ascending: true })
    .order("round_no", { ascending: true })
    .order("match_no", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const schedulesRes = await supabasePublic
    .from("tournament_round_schedules")
    .select("bracket,round_no,scheduled_at,location")
    .eq("tournament_id", tournamentId);

  if (
    schedulesRes.error &&
    !schedulesRes.error.message.includes("tournament_round_schedules")
  ) {
    return NextResponse.json({ error: schedulesRes.error.message }, { status: 500 });
  }

  const schedulesMap = new Map<
    string,
    { scheduledAt: string | null; location: string | null }
  >();
  for (const row of schedulesRes.data ?? []) {
    const bracket = parseBracket(row.bracket);
    const roundNo = Number(row.round_no ?? 0);
    if (!roundNo) continue;
    schedulesMap.set(`${bracket}:${roundNo}`, {
      scheduledAt: typeof row.scheduled_at === "string" ? row.scheduled_at : null,
      location: typeof row.location === "string" ? row.location : null,
    });
  }

  const matches: MatchView[] = (data ?? []).map((item) => {
    const m = item as {
      id?: unknown;
      bracket?: unknown;
      round_no?: unknown;
      match_no?: unknown;
      bo?: unknown;
      status?: unknown;
      score_a?: unknown;
      score_b?: unknown;
      winner_team_id?: unknown;
      team_a_id?: unknown;
      team_b_id?: unknown;
      team_a?: unknown;
      team_b?: unknown;
    };

    const schedule = schedulesMap.get(`${parseBracket(m.bracket)}:${Number(m.round_no ?? 0)}`);
    return {
      id: String(m.id ?? ""),
      bracket: parseBracket(m.bracket),
      roundNo: Number(m.round_no ?? 0),
      matchNo: Number(m.match_no ?? 0),
      bo: Number(m.bo ?? 1),
      status: typeof m.status === "string" ? m.status : "pending",
      scoreA: m.score_a === null ? null : Number(m.score_a ?? 0),
      scoreB: m.score_b === null ? null : Number(m.score_b ?? 0),
      winnerTeamId: typeof m.winner_team_id === "string" ? m.winner_team_id : null,
      teamAId: typeof m.team_a_id === "string" ? m.team_a_id : null,
      teamBId: typeof m.team_b_id === "string" ? m.team_b_id : null,
      teamA: parseTeamRef(m.team_a),
      teamB: parseTeamRef(m.team_b),
      scheduledAt: schedule?.scheduledAt ?? null,
      scheduledLocation: schedule?.location ?? null,
    };
  });

  const grouped: Record<string, Record<string, MatchView[]>> = {};
  for (const m of matches) {
    const b = m.bracket;
    grouped[b] ??= {};
    grouped[b][String(m.roundNo)] ??= [];
    grouped[b][String(m.roundNo)].push(m);
  }

  const finishedTeamMatches = matches
    .filter((m) => m.status === "finished")
    .map((m) => ({
      team_a_id: m.teamAId,
      team_b_id: m.teamBId,
      status: m.status,
    }));

  const teamIds = Array.from(
    new Set(
      finishedTeamMatches
        .flatMap((m) => [m.team_a_id, m.team_b_id])
        .filter((id): id is string => Boolean(id))
    )
  );

  const teamSizeMap = new Map<string, number>();
  if (teamIds.length > 0) {
    const { data: members, error: membersErr } = await supabasePublic
      .from("team_members")
      .select("team_id")
      .in("team_id", teamIds);

    if (membersErr) {
      return NextResponse.json({ error: membersErr.message }, { status: 500 });
    }

    for (const m of members ?? []) {
      const teamId = String(m.team_id ?? "");
      if (!teamId) continue;
      teamSizeMap.set(teamId, (teamSizeMap.get(teamId) ?? 0) + 1);
    }
  }

  const totalBeers = computeBeersFromFinishedMatches(finishedTeamMatches, teamSizeMap);

  return NextResponse.json({ matches, grouped, totalBeers });
}
