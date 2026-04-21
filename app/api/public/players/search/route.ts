import { NextResponse } from "next/server";
import { supabasePublic } from "@/lib/supabasePublic";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  let query = supabasePublic
    .from("players")
    .select("id,name,active,created_at,mmr,mmr_manual_override")
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(50);

  if (q) {
    query = query.ilike("name", `%${q}%`);
  }

  const primary = await query;

  if (primary.error && primary.error.message.includes("mmr_manual_override")) {
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
    }));

    return NextResponse.json({ players: fallbackRows });
  }

  if (primary.error) return NextResponse.json({ error: primary.error.message }, { status: 500 });

  return NextResponse.json({ players: primary.data ?? [] });
}
