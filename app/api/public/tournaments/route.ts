import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await supabaseServer
    .from("tournaments")
    .select("id,name,created_at,format,mode,bo_default,bo_finals")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ tournaments: data ?? [] });
}
