import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export async function GET() {
  const primary = await supabaseServer
    .from("tournaments")
    .select("id,name,created_at,format,mode,bo_default,bo_finals,event_at,event_location,join_deadline_at")
    .order("created_at", { ascending: false });

  let data = primary.data;
  let error = primary.error;

  if (
    primary.error &&
    (primary.error.message.includes("event_at") ||
      primary.error.message.includes("event_location") ||
      primary.error.message.includes("join_deadline_at"))
  ) {
    const fallback = await supabaseServer
      .from("tournaments")
      .select("id,name,created_at,format,mode,bo_default,bo_finals")
      .order("created_at", { ascending: false });

    data = (fallback.data ?? []).map((row) => ({
      ...row,
      event_at: null,
      event_location: null,
      join_deadline_at: null,
    }));
    error = fallback.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ tournaments: data ?? [] });
}
