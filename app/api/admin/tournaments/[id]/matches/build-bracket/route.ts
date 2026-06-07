import { NextResponse } from "next/server";
import { assertTournamentAdmin } from "@/app/api/admin/tournaments/_auth";
import { buildDoubleElimBracket } from "@/lib/matches/buildDoubleElim";
import { markTournamentStarted } from "@/lib/tournaments/markStarted";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tournamentId } = await params;

  const auth = await assertTournamentAdmin(req, tournamentId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 });

  try {
    const result = await buildDoubleElimBracket(tournamentId, { clearExisting: true });
    await markTournamentStarted(tournamentId);
    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const status = message === "not_double_elim" ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
