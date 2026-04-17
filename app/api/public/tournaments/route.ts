import { NextResponse } from "next/server";
import { supabasePublic } from "@/lib/supabasePublic";

export async function GET() {
  const { data, error } = await supabasePublic
    .from("tournaments_public")
    .select("id,name,created_at,format,bo_default,bo_finals")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ tournaments: data ?? [] });
}