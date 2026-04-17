import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { computeBeersFromFinishedMatches } from "@/lib/beers";

export async function GET() {
  const { data, error } = await supabaseServer
    .from("tournament_matches")
    .select("team_a_id,team_b_id,status")
    .eq("status", "finished");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const finishedTeamMatches = (data ?? []).map((m) => ({
    team_a_id: typeof m.team_a_id === "string" ? m.team_a_id : null,
    team_b_id: typeof m.team_b_id === "string" ? m.team_b_id : null,
    status: "finished",
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
    const { data: members, error: membersErr } = await supabaseServer
      .from("team_members")
      .select("team_id")
      .in("team_id", teamIds);

    if (membersErr) return NextResponse.json({ error: membersErr.message }, { status: 500 });

    for (const m of members ?? []) {
      const teamId = String(m.team_id ?? "");
      if (!teamId) continue;
      teamSizeMap.set(teamId, (teamSizeMap.get(teamId) ?? 0) + 1);
    }
  }

  const totalBeers = computeBeersFromFinishedMatches(finishedTeamMatches, teamSizeMap);

  return NextResponse.json({ totalBeers });
}
