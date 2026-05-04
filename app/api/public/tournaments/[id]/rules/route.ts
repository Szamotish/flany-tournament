import { NextResponse } from "next/server";
import { readTournamentRules } from "@/lib/tournamentRules";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const rules = await readTournamentRules(id);
  return NextResponse.json(rules);
}
