import { NextResponse } from "next/server";
import { assertTournamentAdmin } from "@/app/api/admin/tournaments/_auth";
import { supabaseServer } from "@/lib/supabaseServer";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tournamentId } = await params;
  const auth = await assertTournamentAdmin(req, tournamentId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });

  const body = await req.json().catch(() => null);
  const eventAtRaw = typeof body?.eventAt === "string" ? body.eventAt.trim() : "";
  const eventLocation = typeof body?.eventLocation === "string" ? body.eventLocation.trim().slice(0, 140) : "";
  const joinDeadlineAtRaw =
    typeof body?.joinDeadlineAt === "string" ? body.joinDeadlineAt.trim() : "";

  const eventAt = eventAtRaw ? new Date(eventAtRaw) : null;
  if (eventAtRaw && Number.isNaN(eventAt?.getTime())) {
    return NextResponse.json({ error: "invalid_eventAt" }, { status: 400 });
  }

  const joinDeadlineAt = joinDeadlineAtRaw ? new Date(joinDeadlineAtRaw) : null;
  if (joinDeadlineAtRaw && Number.isNaN(joinDeadlineAt?.getTime())) {
    return NextResponse.json({ error: "invalid_joinDeadlineAt" }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("tournaments")
    .update({
      event_at: eventAt ? eventAt.toISOString() : null,
      event_location: eventLocation || null,
      join_deadline_at: joinDeadlineAt ? joinDeadlineAt.toISOString() : null,
    })
    .eq("id", tournamentId)
    .select("id,event_at,event_location,join_deadline_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tournament: data });
}
