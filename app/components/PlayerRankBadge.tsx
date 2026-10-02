import Image from "next/image";
import { rankLabel, type DisplayRank } from "@/lib/playerRank";

import { BADGE_BY_RANK } from "@/lib/ui/rankBadge";

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
