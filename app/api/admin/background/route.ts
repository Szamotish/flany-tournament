import { NextResponse } from "next/server";
import { assertMainAdmin } from "@/app/api/admin/_auth";
import {
  APP_BACKGROUND_VARIANTS,
  normalizeAppBackground,
  readAppBackground,
  writeAppBackground,
} from "@/lib/appBackground";

export async function GET(req: Request) {
  if (!assertMainAdmin(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const background = await readAppBackground();
  return NextResponse.json({ background, variants: APP_BACKGROUND_VARIANTS });
}

export async function POST(req: Request) {
  if (!assertMainAdmin(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { background?: unknown } = {};
  try {
    body = (await req.json()) as { background?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const background = normalizeAppBackground(body.background);
  if (!background) {
    return NextResponse.json(
      { error: "invalid_background", allowed: APP_BACKGROUND_VARIANTS },
      { status: 400 }
    );
  }

  await writeAppBackground(background);
  return NextResponse.json({ ok: true, background });
}
