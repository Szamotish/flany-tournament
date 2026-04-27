import { supabaseServer } from "@/lib/supabaseServer";

export type RequestAuthContext = {
  userId: string;
  email: string | null;
  playerId: string | null;
  playerName: string | null;
  playerActive: boolean;
  isMainAdmin: boolean;
};

type AuthOk = { ok: true; ctx: RequestAuthContext };
type AuthErr = { ok: false; error: string; status: number };

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("authorization")?.trim() ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

export async function readAuthContext(req: Request): Promise<AuthOk | AuthErr> {
  const token = extractBearerToken(req);
  if (!token) return { ok: false, error: "missing_bearer_token", status: 401 };

  const { data: authData, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !authData.user) {
    return { ok: false, error: "invalid_or_expired_token", status: 401 };
  }

  const primaryPlayer = await supabaseServer
    .from("players")
    .select("id,name,active,is_main_admin")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();

  if (primaryPlayer.error && primaryPlayer.error.message.includes("auth_user_id")) {
    return { ok: false, error: "missing_auth_schema", status: 500 };
  }

  let playerRow = primaryPlayer.data as {
    id: string;
    name: string;
    active: boolean;
    is_main_admin?: boolean | null;
  } | null;

  if (primaryPlayer.error && primaryPlayer.error.message.includes("is_main_admin")) {
    const fallbackPlayer = await supabaseServer
      .from("players")
      .select("id,name,active")
      .eq("auth_user_id", authData.user.id)
      .maybeSingle();

    if (fallbackPlayer.error) {
      return { ok: false, error: fallbackPlayer.error.message, status: 500 };
    }

    playerRow = fallbackPlayer.data ? { ...fallbackPlayer.data, is_main_admin: false } : null;
  }

  if (primaryPlayer.error && !primaryPlayer.error.message.includes("is_main_admin")) {
    return { ok: false, error: primaryPlayer.error.message, status: 500 };
  }

  return {
    ok: true,
    ctx: {
      userId: authData.user.id,
      email: authData.user.email ?? null,
      playerId: playerRow?.id ?? null,
      playerName: playerRow?.name ?? null,
      playerActive: playerRow?.active === true,
      isMainAdmin: playerRow?.is_main_admin === true,
    },
  };
}

export async function assertMainAdmin(req: Request): Promise<AuthOk | AuthErr> {
  const auth = await readAuthContext(req);
  if (!auth.ok) return auth;
  if (!auth.ctx.isMainAdmin) {
    return { ok: false, error: "forbidden_main_admin_only", status: 403 };
  }
  return auth;
}
