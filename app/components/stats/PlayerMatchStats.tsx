import Link from "next/link";
import { STAT_VIEWS, STAT_VIEW_LABELS, type PlayerStatsData, type StatView } from "@/lib/matchStats";
import StatsCarousel from "./StatsCarousel";
import StatsValues from "./StatsValues";
import styles from "./Stats.module.css";

export default function PlayerMatchStats({ data, initial, totalBeers }: { data: PlayerStatsData | null; initial: StatView; totalBeers: number }) {
  if (!data) return <article className={`profile-card profile-beers ${styles.profile}`}><h2>Statystyki gry</h2><p>Wypite piwa · łącznie: {totalBeers}</p><p>Nie udało się wczytać pozostałych statystyk.</p></article>;
  return <StatsCarousel key={initial} title="Statystyki gry" className={`profile-card profile-beers ${styles.profile}`} labels={STAT_VIEWS.map(v => STAT_VIEW_LABELS[v])} initial={STAT_VIEWS.indexOf(initial)}>
    {STAT_VIEWS.map(view => <div key={view}><h2>Statystyki gry</h2>
      {view === "last" && data.last && <Link className={styles.event} href={data.last.href}>{data.last.name}</Link>}
      <StatsValues data={data.views[view]} average={view !== "last"} totalBeers={totalBeers} />
    </div>)}
  </StatsCarousel>;
}
