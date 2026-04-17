import Link from "next/link";
import TrophyIcon from "@/app/components/TrophyIcon";
import BracketTree, { type BracketTreeRound } from "@/app/components/BracketTree";
import { supabaseServer } from "@/lib/supabaseServer";
import { teamToneVars } from "@/lib/ui/teamTone";
import { computeBeersFromFinishedMatches } from "@/lib/beers";

type PlayerRef = { id: string; name: string; avatarUrl: string | null };
type Bracket = "single" | "winners" | "losers" | "grand_final";

type MatchView = {
  id: string;
  bracket: Bracket;
  roundNo: number;
  matchNo: number;
  status: string;
  winnerTeamId: string | null;
  teamAId: string | null;
  teamBId: string | null;
  teamAName: string;
  teamBName: string;
};

type ChampionData = {
  teamId: string;
  teamName: string;
  roster: PlayerRef[];
} | null;

function parsePlayerRef(value: unknown): PlayerRef | null {
  const source = Array.isArray(value) ? value[0] : value;
  if (!source || typeof source !== "object") return null;
  const player = source as { id?: unknown; name?: unknown; avatar_url?: unknown };
  if (typeof player.id !== "string" || typeof player.name !== "string") return null;
  return {
    id: player.id,
    name: player.name,
    avatarUrl: typeof player.avatar_url === "string" ? player.avatar_url : null,
  };
}

function isPlayerRef(value: unknown): value is PlayerRef {
  return Boolean(parsePlayerRef(value));
}

function bracketLabel(bracket: Bracket): string {
  if (bracket === "winners") return "Winners";
  if (bracket === "losers") return "Losers";
  if (bracket === "grand_final") return "Grand Final";
  return "Single";
}

function bracketTone(bracket: Bracket): string {
  if (bracket === "winners") return "tour-bracket-winners";
  if (bracket === "losers") return "tour-bracket-losers";
  if (bracket === "grand_final") return "tour-bracket-gf";
  return "tour-bracket-single";
}

function teamState(match: MatchView, teamId: string | null): "empty" | "pending" | "winner" | "loser" {
  if (!teamId) return "empty";
  if (match.status !== "finished" || !match.winnerTeamId) return "pending";
  return match.winnerTeamId === teamId ? "winner" : "loser";
}

export default async function TournamentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [
    { data: t, error: tErr },
    { data: tp, error: tpErr },
    { data: finishedMatches },
    { data: winnerRow },
    { data: matchRows, error: matchesErr },
  ] = await Promise.all([
    supabaseServer
      .from("tournaments_public")
      .select("id,name,created_at,format,bo_default,bo_finals")
      .eq("id", id)
      .maybeSingle(),
    supabaseServer
      .from("tournament_players")
      .select("player_id, players(id,name,avatar_url)")
      .eq("tournament_id", id),
    supabaseServer
      .from("tournament_matches")
      .select("team_a_id,team_b_id,status")
      .eq("tournament_id", id)
      .eq("status", "finished"),
    supabaseServer
      .from("tournament_results")
      .select("team_id")
      .eq("tournament_id", id)
      .eq("placement", 1)
      .maybeSingle(),
    supabaseServer
      .from("tournament_matches")
      .select("id,bracket,round_no,match_no,status,winner_team_id,team_a_id,team_b_id,team_a:team_a_id(id,name),team_b:team_b_id(id,name)")
      .eq("tournament_id", id)
      .order("bracket", { ascending: true })
      .order("round_no", { ascending: true })
      .order("match_no", { ascending: true }),
  ]);

  const finishedTeamMatches = (finishedMatches ?? []).map((m) => ({
    team_a_id: typeof m.team_a_id === "string" ? m.team_a_id : null,
    team_b_id: typeof m.team_b_id === "string" ? m.team_b_id : null,
    status: "finished",
  }));

  const teamIdsForBeers = Array.from(
    new Set(
      finishedTeamMatches
        .flatMap((m) => [m.team_a_id, m.team_b_id])
        .filter((id): id is string => Boolean(id))
    )
  );

  const teamSizeMap = new Map<string, number>();
  if (teamIdsForBeers.length > 0) {
    const { data: members } = await supabaseServer
      .from("team_members")
      .select("team_id")
      .in("team_id", teamIdsForBeers);

    for (const m of members ?? []) {
      const teamId = String(m.team_id ?? "");
      if (!teamId) continue;
      teamSizeMap.set(teamId, (teamSizeMap.get(teamId) ?? 0) + 1);
    }
  }

  const tournamentBeers = computeBeersFromFinishedMatches(finishedTeamMatches, teamSizeMap);

  const players = (tp ?? [])
    .map((x) => x.players as unknown)
    .filter(isPlayerRef)
    .sort((a, b) => a.name.localeCompare(b.name, "pl"));

  const matches: MatchView[] = (matchRows ?? []).map((m) => {
    const row = m as {
      id?: unknown;
      bracket?: unknown;
      round_no?: unknown;
      match_no?: unknown;
      status?: unknown;
      winner_team_id?: unknown;
      team_a_id?: unknown;
      team_b_id?: unknown;
      team_a?: unknown;
      team_b?: unknown;
    };

    const teamA = parsePlayerRef(row.team_a);
    const teamB = parsePlayerRef(row.team_b);

    const bracket: Bracket =
      row.bracket === "winners" || row.bracket === "losers" || row.bracket === "grand_final" || row.bracket === "single"
        ? row.bracket
        : "single";

    return {
      id: String(row.id ?? ""),
      bracket,
      roundNo: Number(row.round_no ?? 0),
      matchNo: Number(row.match_no ?? 0),
      status: typeof row.status === "string" ? row.status : "pending",
      winnerTeamId: typeof row.winner_team_id === "string" ? row.winner_team_id : null,
      teamAId: typeof row.team_a_id === "string" ? row.team_a_id : null,
      teamBId: typeof row.team_b_id === "string" ? row.team_b_id : null,
      teamAName: teamA?.name ?? "TBD",
      teamBName: teamB?.name ?? "TBD",
    };
  });

  const grouped: Record<string, Record<string, MatchView[]>> = {};
  for (const m of matches) {
    grouped[m.bracket] ??= {};
    grouped[m.bracket][String(m.roundNo)] ??= [];
    grouped[m.bracket][String(m.roundNo)].push(m);
  }

  for (const b of Object.keys(grouped)) {
    for (const r of Object.keys(grouped[b])) {
      grouped[b][r].sort((a, c) => a.matchNo - c.matchNo);
    }
  }

  const bracketOrder: Bracket[] = t?.format === "double_elim" ? ["winners", "losers", "grand_final"] : ["single"];

  let champion: ChampionData = null;
  if (winnerRow?.team_id) {
    const championTeamId = String(winnerRow.team_id);

    const [{ data: team }, { data: members }] = await Promise.all([
      supabaseServer
        .from("teams")
        .select("id,name")
        .eq("id", championTeamId)
        .maybeSingle(),
      supabaseServer
        .from("team_members")
        .select("team_id, players(id,name,avatar_url)")
        .eq("team_id", championTeamId),
    ]);

    const roster: PlayerRef[] = (members ?? [])
      .map((m) => parsePlayerRef((m as { players?: unknown }).players))
      .filter((p): p is PlayerRef => Boolean(p))
      .sort((a, b) => a.name.localeCompare(b.name, "pl"));

    champion = {
      teamId: championTeamId,
      teamName: team?.name ? String(team.name) : "Druzyna",
      roster,
    };
  }

  return (
    <main className="tour-root">
      <div className="tour-shell">
        <div className="tour-topbar">
          <Link className="underline opacity-80" href="/tournaments">
            Back
          </Link>
          <span className="tour-kicker">Podglad turnieju</span>
        </div>

        {!t ? (
          <section className="tour-detail-main mt-4">
            <p className="text-red-600">{tErr ? `Blad: ${tErr.message}` : "Nie znaleziono turnieju"}</p>
          </section>
        ) : (
          <>
            <section className="tour-preview-grid mt-4">
              <div className="tour-preview-left">
                <section className="tour-detail-main">
                  <h1 className="tour-title">{t.name}</h1>
                  <p className="tour-muted mt-1">
                    Format: {t.format} - BO{t.bo_default} - final BO{t.bo_finals}
                  </p>

                  <div className="tour-actions mt-4">
                    <Link className="tour-action-btn" href={`/tournaments/${id}/teams`}>
                      Druzyny
                    </Link>
                    <Link className="tour-action-btn" href={`/tournaments/${id}/matches`}>
                      Mecze
                    </Link>
                  </div>
                </section>

                <section className="tour-players mt-4">
                  <h2 className="tour-section-title">Zawodnicy</h2>

                  {tpErr ? (
                    <p className="mt-2 text-sm text-red-600">Blad: {tpErr.message}</p>
                  ) : players.length === 0 ? (
                    <p className="mt-2 tour-muted">Brak zawodnikow w turnieju.</p>
                  ) : (
                    <div className="tour-players-grid mt-3">
                      {players.map((p) => (
                        <Link key={p.id} className="tour-player-chip tour-player-chip-avatar" href={`/players/${p.id}`}>
                          {p.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.avatarUrl} alt="" className="tour-player-avatar" />
                          ) : (
                            <span className="tour-player-avatar tour-player-avatar-fallback">
                              {p.name.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <span>{p.name}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              <section className="tour-preview-bracket">
                <h2 className="tour-section-title">Drabinka</h2>
                {matchesErr ? (
                  <p className="mt-2 text-sm text-red-600">Blad meczow: {matchesErr.message}</p>
                ) : matches.length === 0 ? (
                  <p className="mt-2 tour-muted">Brak meczow do podgladu.</p>
                ) : (
                  <div className="tour-preview-bracket-groups mt-3">
                    {bracketOrder.map((bracket) => {
                      const rounds = grouped[bracket];
                      if (!rounds) return null;

                      const roundNos = Object.keys(rounds)
                        .map(Number)
                        .sort((a, b) => a - b);

                      const treeRounds: BracketTreeRound[] = roundNos.map((roundNo) => ({
                        roundNo,
                        matches: (rounds[String(roundNo)] ?? []).map((m) => ({
                          id: m.id,
                          teamAId: m.teamAId,
                          teamBId: m.teamBId,
                          teamAName: m.teamAName,
                          teamBName: m.teamBName,
                          teamAState: teamState(m, m.teamAId),
                          teamBState: teamState(m, m.teamBId),
                        })),
                      }));

                      return (
                        <article key={bracket} className="tour-preview-bracket-group">
                          <div className="tour-match-bracket-head">
                            <h3 className="tour-preview-bracket-title">{bracketLabel(bracket)}</h3>
                            <span className={`tour-bracket-pill ${bracketTone(bracket)}`}>{roundNos.length} rund</span>
                          </div>

                          <div className="mt-3">
                            <BracketTree rounds={treeRounds} variant="compact" />
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </section>

            <section className="tour-preview-bottom mt-4">
              <article className="tour-beers-card">
                <p className="tour-section-title">Wypite piwa</p>
                <p className="tour-beers-value">{tournamentBeers}</p>
              </article>

              {champion && (
                <article className="tour-champion" style={teamToneVars(champion.teamId)}>
                  <div className="tour-champion-inner">
                    <TrophyIcon seed={`detail-${id}`} className="tour-champion-trophy" />
                    <div>
                      <p className="tour-winner-label">Zwyciezca turnieju</p>
                      <p className="tour-winner-team">{champion.teamName}</p>
                      {champion.roster.length > 0 && (
                        <p className="tour-winner-roster">Sklad: {champion.roster.map((p) => p.name).join(", ")}</p>
                      )}
                    </div>
                  </div>
                </article>
              )}
            </section>
          </>
        )}
      </div>

      <Link href={`/tournaments/${id}/admin`} className="admin-fab" aria-label="Panel lokalnego admina">
        Admin
      </Link>
    </main>
  );
}

