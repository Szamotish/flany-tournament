import { lossStreakTier } from "@/lib/rankedStreak";
import StreakBadge from "./StreakBadge";

export default function LosestreakBadge({ losses }: { losses: number }) {
  const tier = lossStreakTier(losses);
  if (tier === "none") return null;
  const description = `${losses} przegranych meczów rankingowych z rzędu. ` +
    "Pierwszy wygrany mecz rankingowy resetuje serię, również w 1v1. " +
    "Wynik całego BO3/BO5 liczy się jako jeden mecz. Bez dodatkowych strat MMR i PP.";
  return (
    <StreakBadge kind="losestreak" tier={tier === "frozen" ? "high" : "low"} count={losses} description={description} />
  );
}
