import type { StatsSummary } from "@/lib/matchStats";
import styles from "./Stats.module.css";

export const statNumber = (n: number | null) => n === null ? "—" : n.toLocaleString("pl-PL", { maximumFractionDigits: 1 });
export default function StatsValues({ data, average = false, totalBeers }: { data: StatsSummary; average?: boolean; totalBeers?: number }) {
  const divisor = average && data.matches ? data.matches : 1;
  const values: [string, string][] = [
    [average ? "Rzuty / mecz" : "Rzuty", statNumber(data.throws / divisor)],
    [average ? "Trafienia / mecz" : "Trafienia środka", statNumber(data.hits / divisor)],
    ["Celność", data.accuracy === null ? "—" : `${statNumber(data.accuracy)}%`],
    ["Ukończenie piwa przy trafieniu", statNumber(data.finishAverage)],
    [average ? "Puszki przeciwnika / mecz" : "Puszki przeciwnika", statNumber(data.opponentHits / divisor)],
    [average ? "Oszustwa / mecz" : "Oszustwa", statNumber(data.cheats / divisor)],
  ];
  if (!data.games) values.length = 0;
  if (totalBeers !== undefined) values.unshift(["Wypite piwa · łącznie", statNumber(totalBeers)]);
  if (data.penaltyHits) values.push([average ? "Trafione karne / mecz" : "Trafione karne", statNumber(data.penaltyHits / divisor)]);
  return <>
    <p className={styles.coverage}>Zapisane: {data.matches}/{data.expectedMatches} meczów · {data.games}/{data.expectedGames} gier</p>
    <dl className={styles.values}>{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {!data.games ? <p className={styles.empty}>Brak zapisanych statystyk w tym okresie.</p> : <>
      <p className={styles.coverage}>Tempo picia: {data.finishes} zapisanych ukończeń{average ? " · celność ze wszystkich rzutów" : ""}</p>
      <details className={styles.beers}><summary>Piwo w zapisanych grach</summary><ul>{data.beers.map(b => <li key={b.name}>{b.name} <strong>{b.count}</strong></li>)}</ul></details>
    </>}
  </>;
}
