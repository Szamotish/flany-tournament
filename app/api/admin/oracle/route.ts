import { assertMainAdmin } from "@/app/api/admin/_auth";
import { supabaseServer } from "@/lib/supabaseServer";
import { oracleConfiguration, readSmallJson } from "@/lib/oracleServer";
import { isOracleModel } from "@/lib/oracleConfig";

export const dynamic = "force-dynamic";
function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store, private" } });
}
async function handle(req: Request, update: boolean) {
  try {
    const auth = await assertMainAdmin(req);
    if (!auth.ok) return reply({ error: "Dostęp tylko dla main admina." }, auth.status);
    let change: { p_mode?: string; p_model?: string } = {};
    if (update) {
      try {
        const body = await readSmallJson(req, 512) as Record<string, unknown>;
        if (!body || Object.keys(body).some((key) => !["mode", "model"].includes(key))
          || !["off", "admin", "public"].includes(String(body.mode)) || !isOracleModel(body.model))
          return reply({ error: "Nieprawidłowe ustawienia." }, 400);
        change = { p_mode: String(body.mode), p_model: body.model };
      } catch { return reply({ error: "Nieprawidłowe ustawienia." }, 400); }
    }
    const { data, error } = await supabaseServer.rpc("oracle_config", { p_user: auth.ctx.userId, ...change });
    if (error || !data) return reply({ error: "Brak konfiguracji kuli. Sprawdź migrację Supabase." }, 503);
    return reply({ ...data, ...oracleConfiguration() });
  } catch { return reply({ error: "Nie udało się odczytać ustawień kuli." }, 503); }
}
export const GET = (req: Request) => handle(req, false);
export const PATCH = (req: Request) => handle(req, true);
