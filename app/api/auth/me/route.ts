import { NextResponse } from "next/server";
import { readAuthContext } from "@/app/api/admin/_auth";

export async function GET(req: Request) {
  const auth = await readAuthContext(req);

  if (!auth.ok) {
    if (auth.status === 401) {
      return NextResponse.json({ authenticated: false, error: auth.error });
    }
    return NextResponse.json({ authenticated: false, error: auth.error }, { status: auth.status });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: auth.ctx.userId,
      email: auth.ctx.email,
    },
    player: auth.ctx.playerId
      ? {
          id: auth.ctx.playerId,
          name: auth.ctx.playerName,
          active: auth.ctx.playerActive,
        }
      : null,
    isMainAdmin: auth.ctx.isMainAdmin,
  });
}
