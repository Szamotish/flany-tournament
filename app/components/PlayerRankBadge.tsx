import Image from "next/image";
import { rankLabel, type DisplayRank } from "@/lib/playerRank";

const BADGE_BY_RANK: Record<DisplayRank, string> = {
  unranked: "/plakietki/unranked.png",
  bronze: "/plakietki/bronze.png",
  silver: "/plakietki/silver.png",
  gold: "/plakietki/gold.png",
  platinum: "/plakietki/platyna.png",
  emerald: "/plakietki/emerald.png",
  diamond: "/plakietki/diament.png",
  master: "/plakietki/master.png",
  grandmaster: "/plakietki/gm.png",
  challenger: "/plakietki/chall.png",
};

export default function PlayerRankBadge({ rank, mmr }: { rank: DisplayRank; mmr: number }) {
  const label = rankLabel(rank);
  const mmrLabel = Number.isFinite(mmr) ? mmr.toFixed(1) : "0.0";

  return (
    <span className={`player-rank-pp player-rank-pp-${rank}`} title={`MMR ${mmrLabel} · Ranga: ${label}`}>
      <Image
        className="player-rank-pp-image"
        src={BADGE_BY_RANK[rank]}
        alt=""
        fill
        sizes="(max-width: 760px) 156px, 186px"
      />
      <span className="player-rank-pp-text">
        <span className="player-rank-pp-label">MMR {mmrLabel}</span>
        <span className="player-rank-pp-value">Ranga: {label}</span>
      </span>
    </span>
  );
}
