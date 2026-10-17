import BestPerformance from "@/app/components/BestPerformance";
import type { BestPerformanceData } from "@/lib/bestPerformance";
import type { HomeMatchStats } from "@/lib/matchStatsServer";
import { STAT_CATEGORIES } from "@/lib/matchStats";
import StatsCarousel from "./StatsCarousel";
import StatsAwards from "./StatsAwards";
import styles from "./Stats.module.css";

export default function HomeStatsCarousel({ performance, stats }: { performance: BestPerformanceData | null; stats: HomeMatchStats | null }) {
  const awards = stats?.awards ?? [];
  return <StatsCarousel title="Wyróżnienia ligi" className={`glass-card landing-performance ${styles.home}`} auto
    labels={["Best Performance", ...awards.map(a => STAT_CATEGORIES[a.category])]}>
    {[<BestPerformance key="wins" data={performance} embedded />, ...awards.map(award => <div key={award.category}>
      <StatsAwards award={award} hideTitle /><p className={styles.coverage}>Ostatnie {stats!.count} turniejów rankingowych · zapisane statystyki</p>
    </div>)]}
  </StatsCarousel>;
}
