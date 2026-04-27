import { NextResponse } from "next/server";
import { assertTournamentAdmin } from "@/app/api/admin/tournaments/_auth";
import { supabaseServer } from "@/lib/supabaseServer";

type Bracket = "single" | "winners" | "losers" | "grand_final";

function normalizeBracket(value: unknown): Bracket | null {
  if (value === "single" || value === "winners" || value === "losers" || value === "grand_final") {
    return value;
  }
  return null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tournamentId } = await params;
  const auth = await assertTournamentAdmin(req, tournamentId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });

  const { data, error } = await supabaseServer
    .from("tournament_round_schedules")
    .select("id,tournament_id,bracket,round_no,scheduled_at,location,updated_at")
    .eq("tournament_id", tournamentId)
    .order("bracket", { ascending: true })
    .order("round_no", { ascending: true });

  if (error) {
    if (error.message.includes("tournament_round_schedules")) {
      return NextResponse.json({ error: "missing_round_schedules_schema" }, { status: 500 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ schedules: data ?? [] });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tournamentId } = await params;
  const auth = await assertTournamentAdmin(req, tournamentId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });

  const body = await req.json().catch(() => null);
  const bracket = normalizeBracket(body?.bracket);
  const roundNo = Number(body?.roundNo ?? 0);
  const scheduledAtRaw = typeof body?.scheduledAt === "string" ? body.scheduledAt.trim() : "";
  const locationRaw = typeof body?.location === "string" ? body.location.trim() : "";
  const location = locationRaw ? locationRaw.slice(0, 140) : null;

  if (!bracket) return NextResponse.json({ error: "invalid_bracket" }, { status: 400 });
  if (!Number.isInteger(roundNo) || roundNo < 1) {
    return NextResponse.json({ error: "invalid_roundNo" }, { status: 400 });
  }

  let scheduledAtIso: string | null = null;
  if (scheduledAtRaw) {
    const dt = new Date(scheduledAtRaw);
    if (Number.isNaN(dt.getTime())) {
      return NextResponse.json({ error: "invalid_scheduledAt" }, { status: 400 });
    }
    scheduledAtIso = dt.toISOString();
  }

  const shouldDelete = !scheduledAtIso && !location;
  if (shouldDelete) {
    const delRes = await supabaseServer
      .from("tournament_round_schedules")
      .delete()
      .eq("tournament_id", tournamentId)
      .eq("bracket", bracket)
      .eq("round_no", roundNo);

    if (delRes.error) {
      if (delRes.error.message.includes("tournament_round_schedules")) {
        return NextResponse.json({ error: "missing_round_schedules_schema" }, { status: 500 });
      }
      return NextResponse.json({ error: delRes.error.message }, { status: 500 });
    }

    return NextResponse.json({ deleted: true, bracket, roundNo });
  }

  const upsertRes = await supabaseServer
    .from("tournament_round_schedules")
    .upsert(
      {
        tournament_id: tournamentId,
        bracket,
        round_no: roundNo,
        scheduled_at: scheduledAtIso,
        location,
        created_by_player_id: auth.ctx.playerId ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tournament_id,bracket,round_no" }
    )
    .select("id,tournament_id,bracket,round_no,scheduled_at,location,updated_at")
    .single();

  if (upsertRes.error) {
    if (upsertRes.error.message.includes("tournament_round_schedules")) {
      return NextResponse.json({ error: "missing_round_schedules_schema" }, { status: 500 });
    }
    return NextResponse.json({ error: upsertRes.error.message }, { status: 500 });
  }

  return NextResponse.json({ schedule: upsertRes.data });
}
