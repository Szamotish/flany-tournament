import { NextResponse } from "next/server";
import { assertTournamentAdmin } from "@/app/api/admin/tournaments/_auth";
import { nextStepDoubleElim } from "@/lib/matches/nextStepDouble";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = await params;

  const auth = await assertTournamentAdmin(req, tournamentId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const result = await nextStepDoubleElim(tournamentId);
  return NextResponse.json(result);
}