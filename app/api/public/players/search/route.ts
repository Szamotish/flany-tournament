import { NextResponse } from "next/server";
import { supabasePublic } from "@/lib/supabasePublic";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  let query = supabasePublic
    .from("players")
    .select("id,name,active,created_at,mmr,mmr_manual_override,auth_user_id")
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(50);

  if (q) {
    query = query.ilike("name", `%${q}%`);
  }

  const primary = await query;

  if (
    primary.error &&
    (primary.error.message.includes("mmr_manual_override") ||
      primary.error.message.includes("auth_user_id"))
  ) {
    let fallbackQuery = supabasePublic
      .from("players")
      .select("id,name,active,created_at,mmr")
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(50);

    if (q) {
      fallbackQuery = fallbackQuery.ilike("name", `%${q}%`);
    }

    const fallback = await fallbackQuery;
    if (fallback.error) return NextResponse.json({ error: fallback.error.message }, { status: 500 });

    const fallbackRows = (fallback.data ?? []).map((row) => ({
      ...row,
      mmr_manual_override: false,
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
    mmr_manual_override: row.mmr_manual_override,
    has_account: row.auth_user_id !== null,
  }));

  return NextResponse.json({ players });
}
