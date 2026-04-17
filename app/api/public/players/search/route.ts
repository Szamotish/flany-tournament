import { NextResponse } from "next/server";
import { supabasePublic } from "@/lib/supabasePublic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  let query = supabasePublic
    .from("players")
    .select("id,name,active,created_at")
    .order("created_at", { ascending: true })
    .limit(50);

  if (q) {
    query = query.ilike("name", `%${q}%`);
  }

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ players: data ?? [] });
}