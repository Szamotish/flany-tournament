import { readAuthContext } from "@/app/api/admin/_auth";
import { supabaseServer } from "@/lib/supabaseServer";

export async function assertTournamentAdmin(req: Request, tournamentId: string) {
  const auth = await readAuthContext(req);
  if (!auth.ok) return auth;

  if (auth.ctx.isMainAdmin) {
    return { ok: true as const, ctx: auth.ctx };
  }

  if (!auth.ctx.playerId) {
    return { ok: false as const, error: "missing_player_profile", status: 403 };
  }

  const { data, error } = await supabaseServer
    .from("tournament_admins")
    .select("player_id")
    .eq("tournament_id", tournamentId)
    .eq("player_id", auth.ctx.playerId)
    .maybeSingle();

  if (error) {
    if (error.message.includes("tournament_admins")) {
      return { ok: false as const, error: "missing_tournament_admins_schema", status: 500 };
    }
    return { ok: false as const, error: error.message, status: 500 };
  }

  if (!data) {
    return { ok: false as const, error: "forbidden_tournament_admin_only", status: 403 };
  }

  return { ok: true as const, ctx: auth.ctx };
}
