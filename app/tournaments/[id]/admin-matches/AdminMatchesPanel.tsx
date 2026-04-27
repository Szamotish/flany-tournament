"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { authedFetch } from "@/lib/authClient";

type Bracket = "single" | "winners" | "losers" | "grand_final";

type Match = {
  id: string;
  bracket: Bracket;
  roundNo: number;
  matchNo: number;
  bo: number;
  scoreA: number | null;
  scoreB: number | null;
  status: string;
  teamA: { id: string; name: string } | null;
  teamB: { id: string; name: string } | null;
  winnerTeamId: string | null;
  scheduledAt: string | null;
  scheduledLocation: string | null;
};

type RoundScheduleDraft = {
  scheduledAt: string;
  location: string;
  saving: boolean;
};

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

function statusTone(status: string): string {
  return status === "finished" ? "tour-match-status-finished" : "tour-match-status-pending";
}

function toInputDateTimeValue(iso: string | null): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "brak";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "brak";
  return parsed.toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminMatchesPanel({ tournamentId }: { tournamentId: string }) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [roundScheduleDrafts, setRoundScheduleDrafts] = useState<Record<string, RoundScheduleDraft>>({});

  async function load() {
    const res = await fetch(`/api/public/tournaments/${tournamentId}/matches`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setMatches(json.matches ?? []);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const res = await fetch(`/api/public/tournaments/${tournamentId}/matches`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!cancelled && res.ok) {
        setMatches(json.matches ?? []);
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [tournamentId]);

  useEffect(() => {
    setRoundScheduleDrafts((prev) => {
      const next: Record<string, RoundScheduleDraft> = { ...prev };
      for (const match of matches) {
        const key = `${match.bracket}:${match.roundNo}`;
        if (!next[key]) {
          next[key] = {
            scheduledAt: toInputDateTimeValue(match.scheduledAt),
            location: match.scheduledLocation ?? "",
            saving: false,
          };
        }
      }
      return next;
    });
  }, [matches]);

  async function start() {
    setMsg(null);
    const res = await authedFetch(`/api/admin/tournaments/${tournamentId}/matches/start`, {
      method: "POST",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad startu: ${json.error ?? res.statusText}`);
      return;
    }
    setMsg("Wystartowano turniej.");
    await load();
  }

  async function report(matchId: string, scoreA: number, scoreB: number) {
    setMsg(null);

    const res = await authedFetch(`/api/admin/tournaments/${tournamentId}/matches/report`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ matchId, scoreA, scoreB }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad wyniku: ${json.error ?? res.statusText}`);
      return;
    }

    await load();
    setMsg("Zapisano wynik.");
  }

  async function saveRoundSchedule(bracket: Bracket, roundNo: number) {
    const key = `${bracket}:${roundNo}`;
    const draft = roundScheduleDrafts[key] ?? { scheduledAt: "", location: "", saving: false };

    setRoundScheduleDrafts((prev) => ({
      ...prev,
      [key]: { ...draft, saving: true },
    }));

    const res = await authedFetch(`/api/admin/tournaments/${tournamentId}/round-schedules`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bracket,
        roundNo,
        scheduledAt: draft.scheduledAt || "",
        location: draft.location || "",
      }),
    });
    const json = await res.json().catch(() => ({}));

    setRoundScheduleDrafts((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? draft), saving: false },
    }));

    if (!res.ok) {
      setMsg(`Blad harmonogramu rundy: ${json.error ?? res.statusText}`);
      return;
    }

    setMsg("Zapisano harmonogram rundy.");
    await load();
  }

  const grouped = useMemo(() => {
    const map: Record<string, Record<string, Match[]>> = {};
    for (const m of matches) {
      map[m.bracket] ??= {};
      map[m.bracket][String(m.roundNo)] ??= [];
      map[m.bracket][String(m.roundNo)].push(m);
    }

    for (const bracket of Object.keys(map)) {
      for (const round of Object.keys(map[bracket])) {
        map[bracket][round].sort((a, b) => a.matchNo - b.matchNo);
      }
    }

    return map;
  }, [matches]);

  const bracketOrder: Bracket[] = ["winners", "losers", "grand_final", "single"];

  return (
    <main className="tour-root">
      <div className="tour-shell">
        <div className="tour-topbar">
          <Link className="underline opacity-80" href={`/tournaments/${tournamentId}/matches`}>
            Back
          </Link>
          <span className="tour-kicker">Admin meczow</span>
        </div>

        <section className="tour-detail-main mt-4">
          <h1 className="tour-title">Admin - Mecze</h1>
        </section>

        <section className="tour-admin-panel mt-4">
          <div className="tour-admin-grid">
            <div className="tour-admin-actions">
              <button className="tour-action-btn" onClick={start}>
                Start turnieju
              </button>
            </div>

            {msg && (
              <p className={`tour-admin-msg ${msg.toLowerCase().includes("blad") ? "tour-admin-msg-error" : ""}`}>
                {msg}
              </p>
            )}
          </div>
        </section>

        {bracketOrder.map((bracket) => {
          const rounds = grouped[bracket];
          if (!rounds) return null;

          const roundNos = Object.keys(rounds)
            .map(Number)
            .sort((a, b) => a - b);

          return (
            <section key={bracket} className="tour-match-bracket mt-4">
              <div className="tour-match-bracket-head">
                <h2 className="tour-section-title">{bracketLabel(bracket)}</h2>
                <span className={`tour-bracket-pill ${bracketTone(bracket)}`}>{roundNos.length} rund</span>
              </div>

              <div className="tour-round-list mt-3">
                {roundNos.map((roundNo) => (
                  <article key={roundNo} className="tour-round-card">
                    <p className="tour-round-title">Runda {roundNo}</p>
                    {(() => {
                      const key = `${bracket}:${roundNo}`;
                      const roundMatches = rounds[String(roundNo)] ?? [];
                      const source = roundMatches[0] ?? null;
                      const draft = roundScheduleDrafts[key] ?? {
                        scheduledAt: toInputDateTimeValue(source?.scheduledAt ?? null),
                        location: source?.scheduledLocation ?? "",
                        saving: false,
                      };

                      return (
                        <div className="tour-round-schedule mt-2">
                          <div className="tour-round-schedule-fields">
                            <input
                              className="tour-admin-input"
                              type="datetime-local"
                              value={draft.scheduledAt}
                              onChange={(e) =>
                                setRoundScheduleDrafts((prev) => ({
                                  ...prev,
                                  [key]: {
                                    ...(prev[key] ?? draft),
                                    scheduledAt: e.target.value,
                                  },
                                }))
                              }
                            />
                            <input
                              className="tour-admin-input"
                              value={draft.location}
                              onChange={(e) =>
                                setRoundScheduleDrafts((prev) => ({
                                  ...prev,
                                  [key]: {
                                    ...(prev[key] ?? draft),
                                    location: e.target.value,
                                  },
                                }))
                              }
                              placeholder="Miejsce rundy"
                              maxLength={140}
                            />
                            <button
                              className="tour-action-btn"
                              type="button"
                              disabled={draft.saving}
                              onClick={() => void saveRoundSchedule(bracket, roundNo)}
                            >
                              {draft.saving ? "Zapisywanie..." : "Zapisz"}
                            </button>
                            <button
                              className="tour-action-btn"
                              type="button"
                              disabled={draft.saving}
                              onClick={() =>
                                setRoundScheduleDrafts((prev) => ({
                                  ...prev,
                                  [key]: {
                                    ...(prev[key] ?? draft),
                                    scheduledAt: "",
                                    location: "",
                                  },
                                }))
                              }
                            >
                              Wyczysc
                            </button>
                          </div>
                          <p className="tour-muted">
                            Ustawiono: {formatDateTime(source?.scheduledAt ?? null)}
                            {source?.scheduledLocation ? ` - ${source.scheduledLocation}` : ""}
                          </p>
                        </div>
                      );
                    })()}

                    <div className="tour-match-list mt-3">
                      {(rounds[String(roundNo)] ?? []).map((m) => (
                        <AdminMatchRow key={m.id} m={m} disabled={false} onReport={report} />
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}

function AdminMatchRow({
  m,
  onReport,
  disabled,
}: {
  m: Match;
  onReport: (matchId: string, scoreA: number, scoreB: number) => Promise<void>;
  disabled: boolean;
}) {
  const [a, setA] = useState(Number(m.scoreA ?? 0));
  const [b, setB] = useState(Number(m.scoreB ?? 0));

  const teamAName = m.teamA?.name ?? "TBD";
  const teamBName = m.teamB?.name ?? "TBD";
  const winnerName = m.winnerTeamId ? (m.winnerTeamId === m.teamA?.id ? teamAName : teamBName) : null;

  return (
    <article className="tour-match-card">
      <div className="tour-match-head">
        <span className="tour-match-meta">Mecz {m.matchNo} - BO{m.bo}</span>
        <span className={`tour-match-status ${statusTone(m.status)}`}>{m.status}</span>
      </div>

      <div className="tour-score-row">
        <span className="tour-team-name">{teamAName}</span>
        <span className="tour-score-box">{m.teamB ? `${a}:${b}` : "BYE"}</span>
        <span className="tour-team-name">{teamBName}</span>
      </div>

      {!m.teamB ? (
        <p className="tour-winner-line">BYE (auto-win)</p>
      ) : (
        <div className="tour-match-edit mt-3">
          <input
            className="tour-match-input"
            type="number"
            min={0}
            max={5}
            value={a}
            onChange={(e) => setA(Number(e.target.value))}
          />
          <span className="tour-match-sep">:</span>
          <input
            className="tour-match-input"
            type="number"
            min={0}
            max={5}
            value={b}
            onChange={(e) => setB(Number(e.target.value))}
          />

          <button className="tour-action-btn tour-match-save" disabled={disabled} onClick={() => onReport(m.id, a, b)}>
            Zapisz
          </button>
        </div>
      )}

      {winnerName && <p className="tour-winner-line">Zwyciezca: {winnerName}</p>}
    </article>
  );
}
