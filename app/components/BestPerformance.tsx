"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { FRAME_BY_RANK, rankLabel } from "@/lib/playerRank";
import type { BestPerformanceData, PerformanceOutcome } from "@/lib/bestPerformance";

const MARKERS: Record<PerformanceOutcome, { image: string; label: string }> = {
  win: { image: "/Green checkmark.png", label: "Wygrana" },
  loss: { image: "/Red X.png", label: "Udział bez zwycięstwa" },
  absent: { image: "/Beige dash.png", label: "Brak udziału" },
};
const date = (iso: string) => new Date(iso).toLocaleDateString("pl-PL", { timeZone: "Europe/Warsaw" });
function winsLabel(wins: number) {
  return wins === 1 ? "zwycięstwo" : wins >= 2 && wins <= 4 ? "zwycięstwa" : "zwycięstw";
}

export default function BestPerformance({ data, embedded = false }: { data: BestPerformanceData | null; embedded?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<{ playerId: string; index: number } | null>(null);
  const leaders = data?.leaders ?? [];
  const tournaments = data?.tournaments ?? [];
  const visible = expanded ? leaders : leaders.slice(0, 3);
  const selectedPlayer = leaders.find(p => p.playerId === selected?.playerId);
  const selectedTournament = selected ? tournaments[selected.index] : null;
  const selectedOutcome = selectedPlayer && selected ? MARKERS[selectedPlayer.outcomes[selected.index]] : null;

  return <article className={embedded ? "" : "glass-card landing-performance"} aria-label="Best Performance">
    <div className="best-performance-heading">
      <h2 className={embedded ? "sr-only" : undefined}>Best Performance</h2>
      {tournaments.length > 0 ? <p>{tournaments.length === 1 ? "Ostatni turniej rankingowy" : `${tournaments.length} ostatnich turniejów rankingowych`}</p> : null}
    </div>
    {!data ? <p className="best-performance-empty">Nie udało się wczytać wyników.</p>
      : !leaders.length ? <p className="best-performance-empty">Wyróżnienie pojawi się po zakończeniu turnieju rankingowego.</p>
      : <>
        <div className={`best-performance-players${leaders.length === 1 ? " is-solo" : ""}${visible.length >= 3 ? " has-three" : ""}`}>
          {visible.map(player => {
            const frame = FRAME_BY_RANK[player.rank];
            return <section key={player.playerId} className={`best-performance-player player-rank-tier-${player.rank}`} aria-label={`Wyróżniony gracz: ${player.name}`}>
              <Link href={`/players/${player.playerId}`} className="best-performance-identity">
                <span className={`player-rank-avatar-wrap best-performance-avatar${frame ? " has-frame" : ""}`}>
                  <span className="player-rank-avatar">
                    {player.avatarUrl ? <span className="best-performance-avatar-photo" style={{ backgroundImage: `url('${player.avatarUrl}')` }} /> : player.name.slice(0, 1).toUpperCase()}
                  </span>
                  {frame ? <span className="player-rank-avatar-frame" style={{ backgroundImage: `url('${frame}')` }} aria-hidden="true" /> : null}
                </span>
                <span className="best-performance-name">{player.name}<small>{rankLabel(player.rank)}</small></span>
              </Link>
              <div className="best-performance-score"><strong>{player.wins}</strong> {winsLabel(player.wins)}</div>
              <p className="best-performance-record">Występy: {player.played}/{tournaments.length} · Wygrane: {Math.round(player.wins / player.played * 100)}%</p>
              <div className="best-performance-markers" aria-label={`Wyniki ${player.name}, od najstarszego do najnowszego turnieju`}>
                {player.outcomes.map((outcome, index) => {
                  const marker = MARKERS[outcome];
                  const tournament = tournaments[index];
                  const label = `${marker.label} · ${date(tournament.playedAt)} · ${tournament.name}`;
                  return <button key={index} type="button" aria-label={label} title={label}
                    aria-pressed={selected?.playerId === player.playerId && selected.index === index}
                    onClick={() => setSelected({ playerId: player.playerId, index })}>
                    <Image src={marker.image} alt="" width={40} height={40} sizes="40px" />
                  </button>;
                })}
              </div>
              <div className="best-performance-timeline"><span>{date(tournaments[0].playedAt)}</span><span>{date(tournaments.at(-1)!.playedAt)}</span></div>
            </section>;
          })}
        </div>
        {leaders.length > 3 ? <button className="best-performance-more" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Pokaż mniej" : `Pozostali współliderzy (${leaders.length - 3})`}
        </button> : null}
        {selectedTournament && selectedPlayer && selectedOutcome ? <div className="best-performance-detail" role="status">
          <span>{selectedPlayer.name} · {selectedOutcome.label} · {date(selectedTournament.playedAt)}</span>
          {selectedTournament.href ? <Link href={selectedTournament.href}>{selectedTournament.name}{selectedTournament.format === "one_vs_one" ? " · 1v1" : ""} →</Link>
            : <span>Turniej prywatny</span>}
        </div> : null}
      </>}
  </article>;
}
