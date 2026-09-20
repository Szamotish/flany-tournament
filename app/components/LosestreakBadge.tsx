import { lossStreakTier } from "@/lib/rankedStreak";

export default function LosestreakBadge({ losses }: { losses: number }) {
  const tier = lossStreakTier(losses);
  if (tier === "none") return null;
  const description = `${losses} przegranych meczów rankingowych z rzędu. ` +
    "Pierwszy wygrany mecz rankingowy resetuje serię, również w 1v1. " +
    "Wynik całego BO3/BO5 liczy się jako jeden mecz. Bez dodatkowych strat MMR i PP.";
  return (
    <span className={`losestreak-badge${tier === "frozen" ? " is-frozen" : ""}`}
      title={description} aria-label={description}>
      <svg className="losestreak-ice" viewBox="0 0 160 46" preserveAspectRatio="none" aria-hidden="true">
        <path d="M3 31 6 17 15 24 21 5 29 24 40 16 45 29 117 29 123 12 132 23 142 4 148 23 155 16 158 34Z"
          fill="#9bdcf5" stroke="#def7ff" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M21 5 22 29 15 24ZM142 4 138 30 132 23ZM123 12 124 30 117 29Z" fill="#edfaff" />
        <path d="M21 5 29 24 22 29ZM142 4 148 23 138 30Z" fill="#5ba9d9" />
        <g className="losestreak-extra-ice">
          <path d="M48 29 54 11 65 30 91 30 102 6 111 30Z" fill="#b7ebff" stroke="#e5faff" strokeWidth="1.2" />
          <path d="M54 11 57 30 48 29ZM102 6 103 30 91 30Z" fill="#f1fcff" />
        </g>
      </svg>
      <span className="losestreak-badge-content">Losestreak <strong>{losses}</strong></span>
    </span>
  );
}
