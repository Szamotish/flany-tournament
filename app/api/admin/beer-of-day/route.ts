import { NextResponse } from "next/server";
import { assertMainAdmin } from "@/app/api/admin/_auth";
import { BEER_LIST } from "@/lib/beers";
import {
  normalizeConfiguredBeerOfDay,
  readConfiguredBeerOfDay,
  writeConfiguredBeerOfDay,
} from "@/lib/appBackground";

export async function GET(req: Request) {
  try {
    const admin = await assertMainAdmin(req);
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error }, { status: admin.status });
    }

    const beerOfDay = await readConfiguredBeerOfDay();
    return NextResponse.json({
      beerOfDay,
      options: BEER_LIST.map((beer) => beer.name),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "unknown_error");
    return NextResponse.json({ error: "beer_of_day_read_failed", detail: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const admin = await assertMainAdmin(req);
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error }, { status: admin.status });
    }

    let body: { beerOfDay?: unknown } = {};
    try {
      body = (await req.json()) as { beerOfDay?: unknown };
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    const beerOfDay = normalizeConfiguredBeerOfDay(body.beerOfDay);
    if (typeof beerOfDay === "undefined") {
      return NextResponse.json(
        { error: "invalid_beer_of_day", allowed: BEER_LIST.map((beer) => beer.name) },
        { status: 400 },
      );
    }

    await writeConfiguredBeerOfDay(beerOfDay);
    return NextResponse.json({ ok: true, beerOfDay });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "unknown_error");
    return NextResponse.json({ error: "beer_of_day_write_failed", detail: message }, { status: 500 });
  }
}
