import { supabaseServer } from "@/lib/supabaseServer";

export async function markTournamentStarted(tournamentId: string): Promise<void> {
  const startedAt = new Date().toISOString();
  const update = await supabaseServer
    .from("tournaments")
    .update({ started_at: startedAt })
    .eq("id", tournamentId)
    .is("started_at", null);

  if (update.error && !update.error.message.includes("started_at")) {
    throw new Error(`tournament_started_at_failed: ${update.error.message}`);
  }
}
