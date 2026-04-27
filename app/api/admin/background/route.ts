import { NextResponse } from "next/server";
import { assertMainAdmin } from "@/app/api/admin/_auth";
import {
  APP_BACKGROUND_VARIANTS,
  normalizeAppBackground,
  readAppBackground,
  writeAppBackground,
} from "@/lib/appBackground";

export async function GET(req: Request) {
  const admin = await assertMainAdmin(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const background = await readAppBackground();
  return NextResponse.json({ background, variants: APP_BACKGROUND_VARIANTS });
}

export async function POST(req: Request) {
  const admin = await assertMainAdmin(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
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
