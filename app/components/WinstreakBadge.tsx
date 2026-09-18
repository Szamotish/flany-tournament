import { streakBonus } from "@/lib/rankedStreak";

export default function WinstreakBadge({ wins, duelWins = 0 }: { wins: number; duelWins?: number }) {
  if (wins < 2) return null;
  const bonus = streakBonus(wins);
  const description = `${wins} wygranych turniejów rankingowych z rzędu. ` +
    `Bonus od 4. wygranej: +0,1 MMR; od 7.: +0,2 MMR do każdego dodatniego przyrostu. ` +
    (duelWins >= 2 ? "Limit 1v1 osiągnięty — wygraj turniej wieloosobowy, aby odblokować kolejne 2 pojedynki. " : "") +
    "Pierwsza przegrana runda rankingowa resetuje serię.";
  return (
    <span className={`winstreak-badge${bonus >= 0.2 ? " is-blazing" : ""}`} title={description} aria-label={description}>
      <svg className="winstreak-flames" viewBox="0 0 160 46" preserveAspectRatio="none" aria-hidden="true">
        <path d="M2 44Q-3 29 7 22Q4 32 13 29Q7 11 22 2Q18 21 29 21Q23 11 34 8Q33 28 46 25Q51 18 49 12Q64 21 57 32L103 32Q98 17 112 10Q107 25 119 24Q124 15 121 5Q139 15 132 29Q145 26 144 14Q159 28 156 44Z" fill="#f97316" />
        <path d="M8 44Q3 34 14 29Q12 39 22 35Q16 23 24 16Q25 36 37 33L126 34Q135 37 136 26Q147 33 151 44Z" fill="#ffd166" />
      </svg>
      <span className="winstreak-badge-content"><span aria-hidden="true">🔥</span> Winstreak <strong>{wins}</strong></span>
    </span>
  );
}
