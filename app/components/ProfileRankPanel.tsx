import type { CSSProperties, ReactNode } from "react";
import type { DisplayRank } from "@/lib/playerRank";

const PANEL_BY_RANK: Record<DisplayRank, string> = {
  unranked: "/panel/unranked.png",
  bronze: "/panel/bronze.png",
  silver: "/panel/silver.png",
  gold: "/panel/gold.png",
  platinum: "/panel/platyna.png",
  emerald: "/panel/emerald.png",
  diamond: "/panel/diament.png",
  master: "/panel/master.png",
  grandmaster: "/panel/grandmaster.png",
  challenger: "/panel/chall.png",
};

export default function ProfileRankPanel({ rank, children }: { rank: DisplayRank; children: ReactNode }) {
  const width = rank === "silver" ? 2146 : 2172;
  const height = rank === "silver" ? 733 : 724;
  // Preserve the ornaments in the top/bottom strips at their original aspect
  // ratio. Only the middle, containing straight side rails, changes height.
  const top = 190;
  const bottom = 230;
  const style = {
    "--rank-panel-image": `url('${PANEL_BY_RANK[rank]}')`,
    "--rank-panel-top-ratio": `${width} / ${top}`,
    "--rank-panel-bottom-ratio": `${width} / ${bottom}`,
    "--rank-panel-center-size": `${(height / (height - top - bottom)) * 100}%`,
    "--rank-panel-center-position": `${(top / (top + bottom)) * 100}%`,
  } as CSSProperties;

  return <div className="profile-rating-box mt-5" style={style}>{children}</div>;
}
