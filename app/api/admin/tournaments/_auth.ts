import { supabaseServer } from "@/lib/supabaseServer";

export async function assertTournamentAdmin(req: Request, tournamentId: string) {
  const pass = req.headers.get("x-tournament-admin-password");
  if (!pass) return { ok: false as const, error: "missing_password" };

  const { data, error } = await supabaseServer
    .from("tournaments")
    .select("local_admin_password")
    .eq("id", tournamentId)
    .single();

  if (error) return { ok: false as const, error: error.message };

  if (data.local_admin_password !== pass) {
    return { ok: false as const, error: "unauthorized" };
  }

  return { ok: true as const };
}