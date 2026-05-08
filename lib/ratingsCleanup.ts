import { supabaseServer } from "@/lib/supabaseServer";

export async function removeRatingsGivenByPlayer(playerId: string): Promise<void> {
  const primaryDelete = await supabaseServer.from("ratings").delete().eq("rater_player_id", playerId);
  if (!primaryDelete.error) return;

  const msg = primaryDelete.error.message ?? "";

  // Backward compatibility for legacy schema variants.
  if (msg.includes("rater_player_id")) {
    const legacyDelete = await supabaseServer.from("ratings").delete().eq("rater_id", playerId);
    if (!legacyDelete.error) return;
    throw new Error(legacyDelete.error.message);
  }

  if (msg.includes("ratings")) return;
  throw new Error(msg);
}

