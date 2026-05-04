import { NextResponse } from "next/server";
import { readAuthContext } from "@/app/api/admin/_auth";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

function hasBearer(req: Request): boolean {
  return (req.headers.get("authorization") ?? "").trim().toLowerCase().startsWith("bearer ");
}

export async function GET(req: Request) {
  const auth = hasBearer(req) ? await readAuthContext(req) : null;
  const playerId = auth?.ok ? auth.ctx.playerId : null;
  const isMainAdmin = auth?.ok ? auth.ctx.isMainAdmin : false;

  const primary = await supabaseServer
    .from("tournaments")
    .select("id,name,created_at,format,mode,bo_default,bo_finals,event_at,event_location,join_deadline_at,is_private")
    .order("created_at", { ascending: false });

  let data = primary.data;
  let error = primary.error;

  if (
    primary.error &&
    (primary.error.message.includes("event_at") ||
      primary.error.message.includes("event_location") ||
      primary.error.message.includes("join_deadline_at") ||
      primary.error.message.includes("is_private"))
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
      is_private: false,
    }));
    error = fallback.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tournaments = data ?? [];
  if (isMainAdmin) return NextResponse.json({ tournaments });

  const privateIds = tournaments
    .filter((t) => (t as { is_private?: boolean | null }).is_private === true)
    .map((t) => String(t.id));

  if (privateIds.length === 0) return NextResponse.json({ tournaments });
  if (!playerId) {
    return NextResponse.json({
      tournaments: tournaments.filter((t) => (t as { is_private?: boolean | null }).is_private !== true),
    });
  }

  const [memberRes, inviteRes] = await Promise.all([
    supabaseServer
      .from("tournament_players")
      .select("tournament_id")
      .eq("player_id", playerId)
      .in("tournament_id", privateIds),
    supabaseServer
      .from("tournament_invites")
      .select("tournament_id")
      .eq("player_id", playerId)
      .eq("status", "pending")
      .in("tournament_id", privateIds),
  ]);

  if (memberRes.error) return NextResponse.json({ error: memberRes.error.message }, { status: 500 });
  if (inviteRes.error && !inviteRes.error.message.includes("tournament_invites")) {
    return NextResponse.json({ error: inviteRes.error.message }, { status: 500 });
  }

  const visiblePrivate = new Set<string>();
  for (const row of memberRes.data ?? []) visiblePrivate.add(String(row.tournament_id));
  for (const row of inviteRes.data ?? []) visiblePrivate.add(String(row.tournament_id));

  return NextResponse.json({
    tournaments: tournaments.filter((t) => {
      const isPrivate = (t as { is_private?: boolean | null }).is_private === true;
      return !isPrivate || visiblePrivate.has(String(t.id));
    }),
  });
}
