import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import TrophyIcon from "@/app/components/TrophyIcon";

export const dynamic = "force-dynamic";

type TournamentRow = {
  id: string;
  name: string;
  created_at: string;
  format: "single_elim" | "double_elim" | null;
  bo_default: number | null;
  bo_finals: number | null;
};

type PlayerBrief = { id: string; name: string };

type WinnerView = {
  teamId: string;
  teamName: string;
  roster: PlayerBrief[];
};

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function parsePlayerBrief(value: unknown): PlayerBrief | null {
  const source = Array.isArray(value) ? value[0] : value;
  if (!source || typeof source !== "object") return null;
  const player = source as { id?: unknown; name?: unknown };
  if (typeof player.id !== "string" || typeof player.name !== "string") return null;
  return { id: player.id, name: player.name };
}

export default async function TournamentsPage() {
  const { data, error } = await supabaseServer
    .from("tournaments_public")
    .select("id,name,created_at,format,bo_default,bo_finals")
    .order("created_at", { ascending: false });

  const tournaments = (data ?? []) as TournamentRow[];
  const tournamentIds = tournaments.map((t) => t.id);

  const winnerByTournament = new Map<string, WinnerView>();

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

              return (
                <Link key={t.id} href={`/tournaments/${t.id}`} className="tour-card">
                  <div className="tour-card-head">
                    <div>
                      <p className="tour-card-title">{t.name}</p>
                      <p className="tour-card-sub">
                        {t.format === "double_elim" ? "Double elimination" : "Single elimination"} - BO
                        {t.bo_default} / final BO{t.bo_finals}
                      </p>
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
      </div>
    </main>
  );
}
