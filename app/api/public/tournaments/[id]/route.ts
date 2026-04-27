import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tournamentId } = await params;

  const [tPrimary, mRes] = await Promise.all([
    supabaseServer
      .from("tournaments")
      .select("id,name,created_at,format,mode,bo_default,bo_finals,event_at,event_location,join_deadline_at")
      .eq("id", tournamentId)
      .maybeSingle(),
    supabaseServer
      .from("tournament_matches")
      .select("*", { count: "exact", head: true })
      .eq("tournament_id", tournamentId),
  ]);

  let tournament = tPrimary.data;
  let tError = tPrimary.error;

  if (
    tPrimary.error &&
    (tPrimary.error.message.includes("event_at") ||
      tPrimary.error.message.includes("event_location") ||
      tPrimary.error.message.includes("join_deadline_at"))
  ) {
    const fallback = await supabaseServer
      .from("tournaments")
      .select("id,name,created_at,format,mode,bo_default,bo_finals")
      .eq("id", tournamentId)
      .maybeSingle();
    tournament = fallback.data
      ? { ...fallback.data, event_at: null, event_location: null, join_deadline_at: null }
      : null;
    tError = fallback.error;
  }

  if (tError) return NextResponse.json({ error: tError.message }, { status: 500 });
  if (!tournament) return NextResponse.json({ error: "tournament_not_found" }, { status: 404 });
  if (mRes.error) return NextResponse.json({ error: mRes.error.message }, { status: 500 });

  return NextResponse.json({
    tournament,
    started: (mRes.count ?? 0) > 0,
  });
}
