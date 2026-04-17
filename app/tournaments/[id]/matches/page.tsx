import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import BracketTree, { type BracketTreeRound } from "@/app/components/BracketTree";

type Match = {
  id: string;
  bracket: "single" | "winners" | "losers" | "grand_final";
  roundNo: number;
  matchNo: number;
  bo: number;
  status: string;
  scoreA: number;
  scoreB: number;
  winnerTeamId: string | null;
  teamA: { id: string; name: string } | null;
  teamB: { id: string; name: string } | null;
};

function parseTeamRef(value: unknown): { id: string; name: string } | null {
  const source = Array.isArray(value) ? value[0] : value;
  if (!source || typeof source !== "object") return null;
  const team = source as { id?: unknown; name?: unknown };
  if (typeof team.id !== "string" || typeof team.name !== "string") return null;
  return { id: team.id, name: team.name };
}

function parseBracket(value: unknown): Match["bracket"] {
  if (value === "winners" || value === "losers" || value === "grand_final") return value;
  return "single";
}

function bracketLabel(bracket: Match["bracket"]): string {
  if (bracket === "winners") return "Winners";
  if (bracket === "losers") return "Losers";
  if (bracket === "grand_final") return "Grand Final";
  return "Single";
}

function bracketTone(bracket: Match["bracket"]): string {
  if (bracket === "winners") return "tour-bracket-winners";
  if (bracket === "losers") return "tour-bracket-losers";
  if (bracket === "grand_final") return "tour-bracket-gf";
  return "tour-bracket-single";
}

function statusTone(status: string): string {
  return status === "finished" ? "tour-match-status-finished" : "tour-match-status-pending";
}

function statusLabel(status: string): string {
  return status === "finished" ? "FINISHED" : "PENDING";
}

function teamState(match: Match, teamId: string | null): "empty" | "pending" | "winner" | "loser" {
  if (!teamId) return "empty";
  if (match.status !== "finished" || !match.winnerTeamId) return "pending";
  return match.winnerTeamId === teamId ? "winner" : "loser";
}

export default async function MatchesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data, error } = await supabaseServer
    .from("tournament_matches")
    .select(
      "id,bracket,round_no,match_no,bo,status,score_a,score_b,winner_team_id,team_a_id,team_b_id,team_a:team_a_id(id,name),team_b:team_b_id(id,name)"
    )
    .eq("tournament_id", id)
    .order("bracket", { ascending: true })
    .order("round_no", { ascending: true })
    .order("match_no", { ascending: true });

  const matches: Match[] = (data ?? []).map((item) => {
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
      team_a?: unknown;
      team_b?: unknown;
    };

    return {
      id: String(m.id ?? ""),
      bracket: parseBracket(m.bracket),
      roundNo: Number(m.round_no ?? 0),
      matchNo: Number(m.match_no ?? 0),
      bo: Number(m.bo ?? 1),
      status: typeof m.status === "string" ? m.status : "pending",
      scoreA: Number(m.score_a ?? 0),
      scoreB: Number(m.score_b ?? 0),
      winnerTeamId: typeof m.winner_team_id === "string" ? m.winner_team_id : null,
      teamA: parseTeamRef(m.team_a),
      teamB: parseTeamRef(m.team_b),
    };
  });

  const grouped: Record<string, Record<string, Match[]>> = {};
  for (const m of matches) {
    const b = m.bracket;
    grouped[b] ??= {};
    grouped[b][String(m.roundNo)] ??= [];
    grouped[b][String(m.roundNo)].push(m);
  }

  const bracketOrder: Match["bracket"][] = ["winners", "losers", "grand_final", "single"];

  return (
    <main className="tour-root">
      <div className="tour-shell">
        <div className="tour-topbar">
          <Link className="underline opacity-80" href={`/tournaments/${id}`}>
            Back
          </Link>
          <span className="tour-kicker">Drabinka meczow</span>
        </div>

        <section className="tour-detail-main mt-4">
          <h1 className="tour-title">Mecze</h1>
          {error && <p className="mt-2 text-sm text-red-600">Blad: {error.message}</p>}
        </section>

        {!error &&
          bracketOrder.map((bracket) => {
            const rounds = grouped[bracket];
            if (!rounds) return null;

            const roundNos = Object.keys(rounds)
              .map(Number)
              .sort((a, b) => a - b);

            const treeRounds: BracketTreeRound[] = roundNos.map((roundNo) => ({
              roundNo,
              matches: (rounds[String(roundNo)] ?? []).map((m) => {
                const teamAName = m.teamA?.name ?? "BYE";
                const teamBName = m.teamB?.name ?? "BYE";
                const winnerName = m.winnerTeamId
                  ? m.winnerTeamId === m.teamA?.id
                    ? teamAName
                    : teamBName
                  : null;

                return {
                  id: m.id,
                  teamAId: m.teamA?.id ?? null,
                  teamBId: m.teamB?.id ?? null,
                  teamAName,
                  teamBName,
                  teamAState: teamState(m, m.teamA?.id ?? null),
                  teamBState: teamState(m, m.teamB?.id ?? null),
                  teamAScore: m.teamB ? String(m.scoreA) : "-",
                  teamBScore: m.teamB ? String(m.scoreB) : "BYE",
                  headerLabel: `Mecz ${m.matchNo} - BO${m.bo}`,
                  statusLabel: statusLabel(m.status),
                  statusClassName: statusTone(m.status),
                  winnerLabel: winnerName ? `Zwyciezca: ${winnerName}` : undefined,
                };
              }),
            }));

            return (
              <section key={bracket} className="tour-match-bracket mt-4">
                <div className="tour-match-bracket-head">
                  <h2 className="tour-section-title">{bracketLabel(bracket)}</h2>
                  <span className={`tour-bracket-pill ${bracketTone(bracket)}`}>{roundNos.length} rund</span>
                </div>

                <div className="mt-3">
                  <BracketTree rounds={treeRounds} variant="detailed" />
                </div>
              </section>
            );
          })}
      </div>

      <Link href={`/tournaments/${id}/admin-matches`} className="admin-fab" aria-label="Panel lokalnego admina meczow">
        Admin
      </Link>
    </main>
  );
}
