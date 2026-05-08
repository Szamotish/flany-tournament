import Link from "next/link";
import { teamToneVars } from "@/lib/ui/teamTone";
import { playerToneStyle } from "@/lib/ui/playerProfile";

export type BracketTreeTeamState = "empty" | "pending" | "winner" | "loser";

export type BracketTreeMatch = {
  id: string;
  teamAId: string | null;
  teamBId: string | null;
  teamAName: string;
  teamBName: string;
  teamAState: BracketTreeTeamState;
  teamBState: BracketTreeTeamState;
  teamAScore?: string;
  teamBScore?: string;
  headerLabel?: string;
  statusLabel?: string;
  statusClassName?: string;
  winnerLabel?: string;
};

export type BracketTreeRound = {
  roundNo: number;
  matches: BracketTreeMatch[];
};

type BracketTreeProps = {
  rounds: BracketTreeRound[];
  variant?: "compact" | "detailed";
  teamDetailsById?: Record<string, { teamName: string; players: Array<{ id: string; name: string; avatarUrl: string | null; profileColor: string | null; isCaptain: boolean }> }>;
};

type TreeMetrics = {
  centersByRound: number[][];
  sourceMap: number[][][];
  treeHeight: number;
  roundWidth: number;
  colGap: number;
  cardHeight: number;
};

function sourceIndexes(currIdx: number, currLen: number, prevLen: number): number[] {
  if (currLen <= 0 || prevLen <= 0) return [];
  const start = Math.floor((currIdx * prevLen) / currLen);
  const end = Math.floor((((currIdx + 1) * prevLen) - 1) / currLen);
  if (start === end) return [Math.max(0, Math.min(prevLen - 1, start))];
  const a = Math.max(0, Math.min(prevLen - 1, start));
  const b = Math.max(0, Math.min(prevLen - 1, end));
  return a === b ? [a] : [a, b];
}

function buildMetrics(rounds: BracketTreeRound[], variant: "compact" | "detailed"): TreeMetrics {
  const roundWidth = variant === "compact" ? 240 : 320;
  const colGap = variant === "compact" ? 88 : 112;
  const cardHeight = variant === "compact" ? 86 : 146;
  const firstGap = variant === "compact" ? 118 : 178;
  const paddingY = 22;

  if (rounds.length === 0) {
    return {
      centersByRound: [],
      sourceMap: [],
      treeHeight: 220,
      roundWidth,
      colGap,
      cardHeight,
    };
  }

  const centersByRound: number[][] = [];
  const sourceMap: number[][][] = [];

  const firstLen = Math.max(1, rounds[0].matches.length);
  const firstCenters = Array.from({ length: firstLen }, (_, i) => paddingY + cardHeight / 2 + i * firstGap);
  centersByRound.push(firstCenters);
  sourceMap.push(Array.from({ length: firstLen }, () => []));

  for (let r = 1; r < rounds.length; r++) {
    const prev = centersByRound[r - 1];
    const currLen = Math.max(1, rounds[r].matches.length);
    const currCenters: number[] = [];
    const currSources: number[][] = [];

    for (let i = 0; i < currLen; i++) {
      const src = sourceIndexes(i, currLen, prev.length);
      currSources.push(src);
      if (src.length === 0) {
        currCenters.push(paddingY + cardHeight / 2 + i * firstGap);
      } else if (src.length === 1) {
        currCenters.push(prev[src[0]]);
      } else {
        currCenters.push((prev[src[0]] + prev[src[1]]) / 2);
      }
    }

    centersByRound.push(currCenters);
    sourceMap.push(currSources);
  }

  const maxCenter = centersByRound.flat().reduce((a, b) => (b > a ? b : a), 0);
  const treeHeight = Math.max(220, Math.ceil(maxCenter + cardHeight / 2 + paddingY));

  return { centersByRound, sourceMap, treeHeight, roundWidth, colGap, cardHeight };
}

export default function BracketTree({ rounds, variant = "compact", teamDetailsById = {} }: BracketTreeProps) {
  const metrics = buildMetrics(rounds, variant);
  const { centersByRound, sourceMap, treeHeight, roundWidth, colGap, cardHeight } = metrics;

  const totalWidth = Math.max(1, rounds.length) * roundWidth + Math.max(0, rounds.length - 1) * colGap;

  return (
    <div className="bracket-tree-scroll">
      <div className="bracket-tree" style={{ width: `${totalWidth}px`, minHeight: `${treeHeight}px` }}>
        <svg
          className="bracket-tree-lines"
          width={totalWidth}
          height={treeHeight}
          viewBox={`0 0 ${totalWidth} ${treeHeight}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          {rounds.map((round, roundIdx) => {
            if (roundIdx === 0) return null;
            return round.matches.map((_, matchIdx) => {
              const currX = roundIdx * (roundWidth + colGap);
              const currCenter = centersByRound[roundIdx]?.[matchIdx];
              if (typeof currCenter !== "number") return null;

              const prevX = (roundIdx - 1) * (roundWidth + colGap);
              const x1 = prevX + roundWidth;
              const x2 = currX;
              const midX = x1 + colGap / 2;

              const sources = sourceMap[roundIdx]?.[matchIdx] ?? [];
              return sources.map((sourceIdx) => {
                const prevCenter = centersByRound[roundIdx - 1]?.[sourceIdx];
                if (typeof prevCenter !== "number") return null;
                const d = `M ${x1} ${prevCenter} H ${midX} V ${currCenter} H ${x2}`;
                return <path key={`${roundIdx}-${matchIdx}-${sourceIdx}`} d={d} className="bracket-tree-path" />;
              });
            });
          })}
        </svg>

        {rounds.map((round, roundIdx) => {
          const x = roundIdx * (roundWidth + colGap);
          return (
            <section
              key={round.roundNo}
              className="bracket-tree-round"
              style={{ left: `${x}px`, width: `${roundWidth}px`, minHeight: `${treeHeight}px` }}
            >
              <p className="tour-round-title">R{round.roundNo}</p>

              {round.matches.map((m, matchIdx) => {
                const center = centersByRound[roundIdx]?.[matchIdx] ?? cardHeight / 2;
                const top = center - cardHeight / 2;

                return (
                  <article
                    key={m.id}
                    className={`bracket-tree-match ${variant === "detailed" ? "bracket-tree-match-detailed" : ""}`}
                    style={{ top: `${top}px` }}
                  >
                    {variant === "detailed" && (
                      <div className="tour-match-head">
                        <span className="tour-match-meta">{m.headerLabel ?? "Mecz"}</span>
                        {m.statusLabel && (
                          <span className={`tour-match-status ${m.statusClassName ?? ""}`}>{m.statusLabel}</span>
                        )}
                      </div>
                    )}

                    <div className={variant === "detailed" ? "tour-tree-team-rows mt-2" : "tour-tree-team-rows"}>
                      <div className="tour-bracket-team-wrap">
                        <div
                          className={`tour-bracket-team tour-bracket-team-${m.teamAState}`}
                          style={teamToneVars(m.teamAId)}
                        >
                          <span className="tour-bracket-dot" />
                          <span className="tour-bracket-name">{m.teamAName}</span>
                          {variant === "detailed" && <span className="tour-score-box">{m.teamAScore ?? "-"}</span>}
                        </div>
                        {m.teamAId && teamDetailsById[m.teamAId] ? (
                          <div className="tour-bracket-team-tooltip" role="tooltip">
                            <p className="tour-bracket-team-tooltip-title">{teamDetailsById[m.teamAId].teamName}</p>
                            <div className="tour-bracket-team-tooltip-list">
                              {teamDetailsById[m.teamAId].players.map((player) => (
                                <Link
                                  key={`${m.id}-a-${player.id}`}
                                  className="tour-player-chip tour-player-chip-avatar player-tone-card"
                                  style={playerToneStyle(player.profileColor)}
                                  href={`/players/${player.id}`}
                                >
                                  {player.avatarUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={player.avatarUrl} alt="" className="tour-player-avatar" />
                                  ) : (
                                    <span className="tour-player-avatar tour-player-avatar-fallback">
                                      {player.name.slice(0, 1).toUpperCase()}
                                    </span>
                                  )}
                                  <span>{player.name}</span>
                                  {player.isCaptain ? <span className="tour-player-captain-diamond" aria-label="Kapitan" /> : null}
                                </Link>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <div className="tour-bracket-team-wrap">
                        <div
                          className={`tour-bracket-team tour-bracket-team-${m.teamBState}`}
                          style={teamToneVars(m.teamBId)}
                        >
                          <span className="tour-bracket-dot" />
                          <span className="tour-bracket-name">{m.teamBName}</span>
                          {variant === "detailed" && <span className="tour-score-box">{m.teamBScore ?? "-"}</span>}
                        </div>
                        {m.teamBId && teamDetailsById[m.teamBId] ? (
                          <div className="tour-bracket-team-tooltip" role="tooltip">
                            <p className="tour-bracket-team-tooltip-title">{teamDetailsById[m.teamBId].teamName}</p>
                            <div className="tour-bracket-team-tooltip-list">
                              {teamDetailsById[m.teamBId].players.map((player) => (
                                <Link
                                  key={`${m.id}-b-${player.id}`}
                                  className="tour-player-chip tour-player-chip-avatar player-tone-card"
                                  style={playerToneStyle(player.profileColor)}
                                  href={`/players/${player.id}`}
                                >
                                  {player.avatarUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={player.avatarUrl} alt="" className="tour-player-avatar" />
                                  ) : (
                                    <span className="tour-player-avatar tour-player-avatar-fallback">
                                      {player.name.slice(0, 1).toUpperCase()}
                                    </span>
                                  )}
                                  <span>{player.name}</span>
                                  {player.isCaptain ? <span className="tour-player-captain-diamond" aria-label="Kapitan" /> : null}
                                </Link>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {variant === "detailed" && m.winnerLabel && <p className="tour-winner-line">{m.winnerLabel}</p>}
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
