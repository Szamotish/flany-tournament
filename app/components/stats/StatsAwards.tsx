import Link from "next/link";
import { FRAME_BY_RANK, type DisplayRank } from "@/lib/playerRank";
import { STAT_CATEGORIES, type StatsAward, type StatsLeader } from "@/lib/matchStats";
import { statNumber } from "./StatsValues";
import styles from "./Stats.module.css";

export default function StatsAwards({ award, hideTitle = false }: { award: Omit<StatsAward, "leaders"> & { leaders: (StatsLeader & { rank?: DisplayRank })[] }; hideTitle?: boolean }) {
  return <div className={styles.award}>
    <h2 className={hideTitle ? "sr-only" : undefined}>{STAT_CATEGORIES[award.category]}</h2>
    <div className={styles.leaders}>{award.leaders.map(p => {
      const frame = p.rank ? FRAME_BY_RANK[p.rank] : null;
      return <div className={styles.leader} key={p.playerId}>
        <Link href={`/players/${p.playerId}`} className={styles.identity}>
          <span className={`player-rank-avatar-wrap ${frame ? "has-frame" : ""}`}>
            <span className="player-rank-avatar">{p.avatarUrl ? <span className={styles.photo} style={{ backgroundImage: `url('${p.avatarUrl}')` }} /> : p.name.slice(0, 1).toUpperCase()}</span>
            {frame && <span className="player-rank-avatar-frame" style={{ backgroundImage: `url('${frame}')` }} aria-hidden="true" />}
          </span><strong>{p.name}</strong>
        </Link>
        <p className={styles.score}>{statNumber(award.value)}{award.category === "accuracy" ? "%" : award.category === "drinking" ? " traf." : ""}</p>
        <p className={styles.coverage}>{award.category === "accuracy" ? `${p.summary.hits}/${p.summary.throws} rzutów · minimum 5 prób` : award.category === "drinking" ? `Średnio do ukończenia · ${p.summary.finishes} piw` : `${p.summary.matches} meczów z danymi`}</p>
      </div>;
    })}</div>
  </div>;
}
