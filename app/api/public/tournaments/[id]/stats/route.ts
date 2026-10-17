import { NextResponse } from "next/server";
import { readAuthContext } from "@/app/api/admin/_auth";
import { supabaseServer } from "@/lib/supabaseServer";
import { isNotebookId } from "@/lib/notebook";
import { readMatchStatsSnapshot } from "@/lib/matchStatsServer";
import { tournamentStats } from "@/lib/tournamentStats";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isNotebookId(id)) return json({ error: "not_found" }, 404);
  const { data: tournament, error } = await supabaseServer.from("tournaments").select("id,is_private").eq("id", id).maybeSingle();
  if (error) return json({ error: "stats_unavailable" }, 503);
  if (!tournament) return json({ error: "not_found" }, 404);
  if (tournament.is_private === true) {
    const auth = await readAuthContext(req);
    if (!auth.ok) return json({ error: "private_tournament" }, 403);
    if (!auth.ctx.isMainAdmin) {
      if (!auth.ctx.playerId) return json({ error: "private_tournament" }, 403);
      const results = await Promise.all([
        supabaseServer.from("tournament_players").select("player_id").eq("tournament_id", id).eq("player_id", auth.ctx.playerId).maybeSingle(),
        supabaseServer.from("tournament_admins").select("player_id").eq("tournament_id", id).eq("player_id", auth.ctx.playerId).maybeSingle(),
        supabaseServer.from("tournament_invites").select("player_id").eq("tournament_id", id).eq("player_id", auth.ctx.playerId).eq("status", "pending").limit(1),
      ]);
      if (results.some(r => r.error)) return json({ error: "stats_unavailable" }, 503);
      if (!results.some(r => Array.isArray(r.data) ? r.data.length > 0 : !!r.data)) return json({ error: "private_tournament" }, 403);
    }
  }
  try { return json(tournamentStats(await readMatchStatsSnapshot(), id)); }
  catch { return json({ error: "stats_unavailable" }, 503); }
}
