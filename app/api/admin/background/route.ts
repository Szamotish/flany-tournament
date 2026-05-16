import { NextResponse } from "next/server";
import { assertMainAdmin } from "@/app/api/admin/_auth";
import {
  APP_BACKGROUND_VARIANTS,
  normalizeAppBackground,
  readAppBackground,
  writeAppBackground,
} from "@/lib/appBackground";

export async function GET(req: Request) {
  try {
    const admin = await assertMainAdmin(req);
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error }, { status: admin.status });
    }

    const background = await readAppBackground();
    return NextResponse.json({ background, variants: APP_BACKGROUND_VARIANTS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "unknown_error");
    return NextResponse.json({ error: "background_read_failed", detail: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "unknown_error");
    return NextResponse.json({ error: "background_write_failed", detail: message }, { status: 500 });
  }
}
