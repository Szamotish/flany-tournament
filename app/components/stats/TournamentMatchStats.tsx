"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { authedFetch } from "@/lib/authClient";
import type { TournamentStatsData } from "@/lib/tournamentStats";
import StatsAwards from "./StatsAwards";
import { statNumber } from "./StatsValues";
import styles from "./Stats.module.css";

export default function TournamentMatchStats({ tournamentId, compact = false }: { tournamentId: string; compact?: boolean }) {
  const [data, setData] = useState<TournamentStatsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await authedFetch(`/api/public/tournaments/${tournamentId}/stats`, { cache: "no-store" });
        const result = await res.json();
        if (!alive) return;
        if (!res.ok) { setError(result.error === "private_tournament" ? "Zaloguj się jako uczestnik lub administrator, aby zobaczyć statystyki tego turnieju." : "Nie udało się wczytać statystyk."); return; }
        setData(result); setError(null);
      } catch { if (alive) setError("Nie udało się wczytać statystyk."); }
    })();
    return () => { alive = false; };
  }, [tournamentId, attempt]);
  return <section className={`glass-card ${styles.tournament}`}>
    <h2>Statystyki turnieju</h2>
    {error ? <p>{error} <button className={styles.retry} onClick={() => setAttempt(n => n + 1)}>Odśwież</button></p> : !data ? <p>Wczytywanie…</p> : <>
      {!data.matches.some(m => m.players.some(p => p.games.length)) ? <p className={styles.empty}>Brak statystyk zakończonych meczów.</p> : <>
        {compact && <><div className={styles.highlights}>{data.awards.filter(a => ["accuracy", "drinking", "opponent"].includes(a.category)).map(a => <StatsAwards key={a.category} award={a} />)}</div>
          <Link className={styles.event} href={`/tournaments/${tournamentId}/matches#statystyki`}>Statystyki wszystkich meczów →</Link></>}
        {!compact && <div id="statystyki">{data.matches.map(match => <details key={match.id} className={styles.match}>
          <summary>{match.label} · {match.players.some(p => p.games.length) ? "Statystyki graczy" : "Brak wpisów"}</summary>
          <div className={styles.tableWrap}><table><caption className={styles.coverage}>Suma meczu · zapisane gry / rozegrane gry</caption>
            <thead><tr><th>Gracz</th><th>Gry</th><th>Rzuty</th><th>Środek</th><th>Celność</th><th>Piwo przy trafieniu (śr.)</th><th>Puszki przeciwnika</th><th>Oszustwa</th>{match.players.some(p => p.summary.penaltyHits) && <th>Karne (w trafieniach)</th>}</tr></thead>
            <tbody>{match.players.map(p => <tr key={p.playerId}><th><Link href={`/players/${p.playerId}`}>{p.name}</Link></th><td>{p.summary.games}/{match.expectedGames}</td>
              <td>{p.summary.games ? p.summary.throws : "—"}</td><td>{p.summary.games ? p.summary.hits : "—"}</td><td>{statNumber(p.summary.accuracy)}{p.summary.accuracy !== null ? "%" : ""}</td>
              <td>{statNumber(p.summary.finishAverage)} ({p.summary.finishes})</td><td>{p.summary.games ? p.summary.opponentHits : "—"}</td><td>{p.summary.games ? p.summary.cheats : "—"}</td>
              {match.players.some(p => p.summary.penaltyHits) && <td>{p.summary.games ? p.summary.penaltyHits : "—"}</td>}</tr>)}</tbody>
          </table></div>
          <details className={styles.beers}><summary>Poszczególne gry i piwa</summary><div className={styles.tableWrap}><table>
            <thead><tr><th>Gra</th><th>Gracz</th><th>Rzuty</th><th>Środek</th><th>Piwo przy trafieniu</th><th>Marka piwa</th></tr></thead>
            <tbody>{match.players.flatMap(p => p.games.map(g => <tr key={`${p.playerId}:${g.game}`}><td>{g.game}</td><th>{p.name}</th><td>{g.throws}</td><td>{g.hits}</td><td>{statNumber(g.finish)}</td><td>{g.beer ?? "Nieznane"}</td></tr>))}</tbody>
          </table></div></details>
        </details>)}</div>}
      </>}
    </>}
  </section>;
}
