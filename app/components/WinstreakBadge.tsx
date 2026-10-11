import { streakBonus } from "@/lib/rankedStreak";
import StreakBadge from "./StreakBadge";

export default function WinstreakBadge({ wins, duelWins = 0 }: { wins: number; duelWins?: number }) {
  if (wins < 2) return null;
  const bonus = streakBonus(wins);
  const description = `${wins} wygranych turniejów rankingowych z rzędu. ` +
    `Bonus od 4. wygranej: +0,1 MMR; od 7.: +0,2 MMR do każdego dodatniego przyrostu. ` +
    (duelWins >= 2 ? "Limit 1v1 osiągnięty — wygraj turniej wieloosobowy, aby odblokować kolejne 2 pojedynki. " : "") +
    "Pierwsza przegrana runda rankingowa resetuje serię.";
  return (
    <StreakBadge kind="winstreak" tier={bonus >= 0.2 ? "high" : "low"} count={wins} description={description} />
  );
}
