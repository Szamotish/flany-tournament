import { NextResponse } from "next/server";
import { readAuthContext } from "@/app/api/admin/_auth";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { supabasePublic } from "@/lib/supabasePublic";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

type PlayerSearchRow = {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
  mmr: number | null;
  prestige_points?: number | null;
  rating_override?: number | null;
  mmr_manual_override?: boolean | null;
  can_rate_others?: boolean | null;
  auth_user_id?: string | null;
};

type QueryResult = {
  data: PlayerSearchRow[] | null;
  error: { message: string } | null;
};

export async function GET(req: Request) {
  const ip = clientIp(req);
  const limit = rateLimit({ key: `players-search:ip:${ip}`, limit: 120, windowMs: 60 * 1000 });
  if (!limit.ok) return rateLimitResponse(limit);

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 40);
  const auth = await readAuthContext(req);
  const canSeeAccountState = auth.ok && (auth.ctx.isMainAdmin || auth.ctx.playerActive);
  const client = canSeeAccountState ? supabaseServer : supabasePublic;
  const selectColumns = canSeeAccountState
    ? "id,name,active,created_at,mmr,prestige_points,rating_override,mmr_manual_override,can_rate_others,auth_user_id"
    : "id,name,active,created_at,mmr,prestige_points,rating_override,mmr_manual_override,can_rate_others";

  let query = client
    .from("players")
    .select(selectColumns)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(50);

  if (q) {
    query = query.ilike("name", `%${q}%`);
  }

  const primary = (await query) as unknown as QueryResult;

  if (
    primary.error &&
    (primary.error.message.includes("mmr_manual_override") ||
      primary.error.message.includes("auth_user_id") ||
      primary.error.message.includes("can_rate_others"))
  ) {
    let fallbackQuery = client
      .from("players")
      .select("id,name,active,created_at,mmr,prestige_points")
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(50);

    if (q) {
      fallbackQuery = fallbackQuery.ilike("name", `%${q}%`);
    }

    const fallback = (await fallbackQuery) as unknown as QueryResult;
    if (fallback.error) return NextResponse.json({ error: fallback.error.message }, { status: 500 });

    const fallbackRows = (fallback.data ?? []).map((row) => ({
      ...row,
      mmr_manual_override: false,
      rating_override: null,
      can_rate_others: false,
      has_account: false,
    }));

    return NextResponse.json({ players: fallbackRows });
  }

  if (primary.error) return NextResponse.json({ error: primary.error.message }, { status: 500 });

  const players = (primary.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    active: row.active,
    created_at: row.created_at,
    mmr: row.mmr,
    prestige_points: row.prestige_points,
    rating_override: row.rating_override,
    mmr_manual_override: row.mmr_manual_override,
    can_rate_others: row.can_rate_others === true,
    has_account:
      canSeeAccountState &&
      Object.prototype.hasOwnProperty.call(row, "auth_user_id") &&
      row.auth_user_id !== null,
  }));

  return NextResponse.json({ players });
}
