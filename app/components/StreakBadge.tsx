import Image from "next/image";
import styles from "./StreakBadge.module.css";

type StreakBadgeProps = {
  kind: "winstreak" | "losestreak";
  tier: "low" | "high";
  count: number;
  description: string;
};

export default function StreakBadge({ kind, tier, count, description }: StreakBadgeProps) {
  return (
    <span className={`${styles.badge} ${kind}-badge`} data-kind={kind} data-tier={tier} title={description} role="img" aria-label={description}>
      <Image
        className={styles.artwork}
        src={`/streaks/${kind}-${tier}.png`}
        alt=""
        width={2172}
        height={724}
        sizes="251px"
        aria-hidden="true"
      />
      <strong className={`${styles.count} ${styles[kind]}`} aria-hidden="true">{count}</strong>
    </span>
  );
}
