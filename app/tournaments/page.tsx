import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import TrophyIcon from "@/app/components/TrophyIcon";
import TournamentsPrivateList from "./TournamentsPrivateList";

export const dynamic = "force-dynamic";

type TournamentRow = {
  id: string;
  name: string;
  created_at: string;
  format: "single_elim" | "double_elim" | null;
  mode: "normal" | "ranked" | null;
  bo_default: number | null;
  bo_finals: number | null;
  event_at: string | null;
  event_location: string | null;
  join_deadline_at: string | null;
  is_private?: boolean | null;
};

type PlayerBrief = { id: string; name: string };
type Bracket = "single" | "winners" | "losers" | "grand_final";

type WinnerView = {
  teamId: string;
  teamName: string;
  roster: PlayerBrief[];
};

type RoundScheduleRow = {
  tournamentId: string;
  bracket: Bracket;
  roundNo: number;
  scheduledAt: string | null;
  location: string | null;
};

type UpcomingRoundView = {
  bracket: Bracket;
  roundNo: number;
  scheduledAt: string | null;
  location: string | null;
  pairs: Array<{ teamA: string; teamB: string }>;
};

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "brak terminu";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "brak terminu";
  return parsed.toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parsePlayerBrief(value: unknown): PlayerBrief | null {
  const source = Array.isArray(value) ? value[0] : value;
  if (!source || typeof source !== "object") return null;
  const player = source as { id?: unknown; name?: unknown };
  if (typeof player.id !== "string" || typeof player.name !== "string") return null;
  return { id: player.id, name: player.name };
}

function parseBracket(value: unknown): Bracket {
  if (value === "winners" || value === "losers" || value === "grand_final") return value;
  return "single";
}

function bracketLabel(bracket: Bracket): string {
  if (bracket === "winners") return "Winners";
  if (bracket === "losers") return "Losers";
  if (bracket === "grand_final") return "Grand Final";
  return "Single";
}

function parseTeamName(value: unknown): string | null {
  const source = Array.isArray(value) ? value[0] : value;
  if (!source || typeof source !== "object") return null;
  const team = source as { name?: unknown };
  if (typeof team.name !== "string") return null;
  return team.name;
}

export default async function TournamentsPage() {
  const primary = await supabaseServer
    .from("tournaments")
    .select("id,name,created_at,format,mode,bo_default,bo_finals,event_at,event_location,join_deadline_at,is_private")
    .or("is_private.is.null,is_private.eq.false")
    .order("created_at", { ascending: false });

  let data = primary.data;
  let error = primary.error;

  if (
    primary.error &&
    (primary.error.message.includes("event_at") ||
      primary.error.message.includes("event_location") ||
      primary.error.message.includes("join_deadline_at") ||
      primary.error.message.includes("is_private"))
  ) {
    const fallback = await supabaseServer
      .from("tournaments")
      .select("id,name,created_at,format,mode,bo_default,bo_finals")
      .order("created_at", { ascending: false });
    data = (fallback.data ?? []).map((row) => ({
      ...row,
      event_at: null,
      event_location: null,
      join_deadline_at: null,
      is_private: false,
    }));
    error = fallback.error;
  }

  const tournaments = (data ?? []) as TournamentRow[];
  const tournamentIds = tournaments.map((t) => t.id);

  const winnerByTournament = new Map<string, WinnerView>();
  const upcomingRoundByTournament = new Map<string, UpcomingRoundView>();

  if (tournamentIds.length > 0) {
    const { data: winners, error: winnersErr } = await supabaseServer
      .from("tournament_results")
      .select("tournament_id,team_id,placement")
      .eq("placement", 1)
      .in("tournament_id", tournamentIds);

    if (!winnersErr && winners && winners.length > 0) {
      const winnerPairs = winners
        .map((w) => ({
          tournamentId: String(w.tournament_id ?? ""),
          teamId: String(w.team_id ?? ""),
        }))
        .filter((w) => w.tournamentId && w.teamId);

      const teamIds = Array.from(new Set(winnerPairs.map((w) => w.teamId)));

      const { data: teams } = await supabaseServer
        .from("teams")
        .select("id,name")
        .in("id", teamIds);

      const teamNameMap = new Map<string, string>();
      for (const t of teams ?? []) {
        teamNameMap.set(String(t.id), String(t.name ?? "Druzyna"));
      }

      const { data: members } = await supabaseServer
        .from("team_members")
        .select("team_id, players(id,name)")
        .in("team_id", teamIds);

      const rosterMap = new Map<string, PlayerBrief[]>();
      for (const m of members ?? []) {
        const teamId = String(m.team_id);
        const p = parsePlayerBrief((m as { players?: unknown }).players);
        if (!p) continue;
        const current = rosterMap.get(teamId) ?? [];
        current.push(p);
        rosterMap.set(teamId, current);
      }

      for (const [teamId, roster] of rosterMap.entries()) {
        rosterMap.set(
          teamId,
          roster.sort((a, b) => a.name.localeCompare(b.name, "pl"))
        );
      }

      for (const pair of winnerPairs) {
        if (winnerByTournament.has(pair.tournamentId)) continue;
        winnerByTournament.set(pair.tournamentId, {
          teamId: pair.teamId,
          teamName: teamNameMap.get(pair.teamId) ?? "Druzyna",
          roster: rosterMap.get(pair.teamId) ?? [],
        });
      }
    }
  }

  if (tournamentIds.length > 0) {
    const schedulesRes = await supabaseServer
      .from("tournament_round_schedules")
      .select("tournament_id,bracket,round_no,scheduled_at,location")
      .in("tournament_id", tournamentIds);

    if (!schedulesRes.error) {
      const scheduleRows: RoundScheduleRow[] = (schedulesRes.data ?? [])
        .map((row) => ({
          tournamentId: String(row.tournament_id ?? ""),
          bracket: parseBracket(row.bracket),
          roundNo: Number(row.round_no ?? 0),
          scheduledAt: typeof row.scheduled_at === "string" ? row.scheduled_at : null,
          location: typeof row.location === "string" ? row.location : null,
        }))
        .filter((row) => row.tournamentId && row.roundNo > 0);

      const rowsByTournament = new Map<string, RoundScheduleRow[]>();
      for (const row of scheduleRows) {
        const current = rowsByTournament.get(row.tournamentId) ?? [];
        current.push(row);
        rowsByTournament.set(row.tournamentId, current);
      }

      const chosenByTournament = new Map<string, RoundScheduleRow>();

      for (const [tournamentId, rows] of rowsByTournament.entries()) {
        const sorted = [...rows].sort((a, b) => {
          const aHas = Boolean(a.scheduledAt);
          const bHas = Boolean(b.scheduledAt);
          if (aHas !== bHas) return aHas ? -1 : 1;
          const aTs = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER;
          const bTs = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER;
          return aTs - bTs;
        });
        const withDate = sorted.find((row) => Boolean(row.scheduledAt));
        const chosen = withDate ?? sorted[0] ?? null;
        if (chosen) chosenByTournament.set(tournamentId, chosen);
      }

      if (chosenByTournament.size > 0) {
        const chosenTournamentIds = Array.from(new Set(Array.from(chosenByTournament.values()).map((x) => x.tournamentId)));
        const chosenKeys = new Set(
          Array.from(chosenByTournament.values()).map((x) => `${x.tournamentId}:${x.bracket}:${x.roundNo}`)
        );

        const matchesRes = await supabaseServer
          .from("tournament_matches")
          .select("tournament_id,bracket,round_no,team_a:team_a_id(name),team_b:team_b_id(name)")
          .in("tournament_id", chosenTournamentIds)
          .order("round_no", { ascending: true })
          .order("match_no", { ascending: true });

        const pairsByKey = new Map<string, Array<{ teamA: string; teamB: string }>>();
        if (!matchesRes.error) {
          for (const row of matchesRes.data ?? []) {
            const tournamentId = String(row.tournament_id ?? "");
            const bracket = parseBracket(row.bracket);
            const roundNo = Number(row.round_no ?? 0);
            if (!tournamentId || !roundNo) continue;
            const key = `${tournamentId}:${bracket}:${roundNo}`;
            if (!chosenKeys.has(key)) continue;

            const teamA = parseTeamName(row.team_a) ?? "TBD";
            const teamB = parseTeamName(row.team_b) ?? "TBD";
            const current = pairsByKey.get(key) ?? [];
            current.push({ teamA, teamB });
            pairsByKey.set(key, current);
          }
        }

        for (const [tournamentId, chosen] of chosenByTournament.entries()) {
          const key = `${tournamentId}:${chosen.bracket}:${chosen.roundNo}`;
          upcomingRoundByTournament.set(tournamentId, {
            bracket: chosen.bracket,
            roundNo: chosen.roundNo,
            scheduledAt: chosen.scheduledAt,
            location: chosen.location,
            pairs: pairsByKey.get(key) ?? [],
          });
        }
      }
    }
  }

  return (
    <main className="tour-root">
      <div className="tour-shell">
        <div className="tour-topbar">
          <Link className="underline opacity-80" href="/">
            Back
          </Link>
          <span className="tour-kicker">Lista turniejow</span>
        </div>

        <section className="tour-hero mt-4">
          <h1 className="tour-title">Turnieje</h1>
          <p className="tour-muted">Przeglad aktywnych i zakonczonych turniejow.</p>
        </section>

        {error ? (
          <p className="mt-4 text-sm text-red-600">Blad pobierania: {error.message}</p>
        ) : tournaments.length === 0 ? (
          <p className="mt-4 text-sm opacity-70">Brak turniejow.</p>
        ) : (
          <section className="tour-list mt-4">
            {tournaments.map((t, idx) => {
              const winner = winnerByTournament.get(t.id);
              const isFinished = Boolean(winner);
              const upcoming = upcomingRoundByTournament.get(t.id) ?? null;

              return (
                <Link key={t.id} href={`/tournaments/${t.id}`} className="tour-card">
                  <div className="tour-card-head">
                    <div>
                      <p className="tour-card-title">{t.name}</p>
                      <p className="tour-card-sub">
                        {t.mode === "ranked" ? "Ranked" : "Normal"} -{" "}
                        {t.format === "double_elim" ? "Double elimination" : "Single elimination"} - BO
                        {t.bo_default} / final BO{t.bo_finals}
                      </p>
                      {!isFinished && upcoming ? (
                        <>
                          <p className="tour-card-sub">
                            Najblizsza runda: {bracketLabel(upcoming.bracket)} R{upcoming.roundNo}
                          </p>
                          <p className="tour-card-sub">
                            {formatDateTime(upcoming.scheduledAt)}
                            {upcoming.location ? ` - ${upcoming.location}` : ""}
                          </p>
                          {upcoming.pairs.length > 0 ? (
                            <div className="tour-upcoming-pairs">
                              {upcoming.pairs.slice(0, 3).map((pair, pairIdx) => (
                                <span key={`${pair.teamA}-${pair.teamB}-${pairIdx}`} className="tour-upcoming-pair">
                                  <span className="tour-upcoming-badge" aria-hidden>
                                    {pair.teamA.slice(0, 1).toUpperCase()}
                                  </span>
                                  <span className="tour-upcoming-name">{pair.teamA}</span>
                                  <span className="tour-upcoming-vs">vs</span>
                                  <span className="tour-upcoming-badge" aria-hidden>
                                    {pair.teamB.slice(0, 1).toUpperCase()}
                                  </span>
                                  <span className="tour-upcoming-name">{pair.teamB}</span>
                                </span>
                              ))}
                              {upcoming.pairs.length > 3 ? (
                                <span className="tour-upcoming-more">+{upcoming.pairs.length - 3} meczow</span>
                              ) : null}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <p className="tour-card-sub">
                          {formatDateTime(t.event_at)}
                          {t.event_location ? ` - ${t.event_location}` : ""}
                        </p>
                      )}
                      {t.join_deadline_at ? (
                        <p className="tour-card-sub">Proby do: {formatDateTime(t.join_deadline_at)}</p>
                      ) : null}
                      <p className="tour-card-sub">{formatDateShort(t.created_at)}</p>
                    </div>
                    <span className={isFinished ? "tour-status tour-status-finished" : "tour-status"}>
                      {isFinished ? "Zakonczony" : "W toku"}
                    </span>
                  </div>

                  {winner ? (
                    <div className="tour-winner-box mt-3">
                      <TrophyIcon seed={`list-${idx}`} className="tour-winner-trophy" />
                      <div>
                        <p className="tour-winner-label">Zwyciezca</p>
                        <p className="tour-winner-team">{winner.teamName}</p>
                        {winner.roster.length > 0 && (
                          <p className="tour-winner-roster">
                            Sklad: {winner.roster.map((p) => p.name).join(", ")}
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="tour-muted mt-3">Brak finalnego zwyciezcy.</p>
                  )}
                </Link>
              );
            })}
          </section>
        )}
        <TournamentsPrivateList publicIds={tournamentIds} />
      </div>
    </main>
  );
}
