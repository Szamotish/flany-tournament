import { NextResponse } from "next/server";
import { readConfiguredBeerOfDay } from "@/lib/appBackground";

export async function GET() {
  try {
    const beerOfDay = await readConfiguredBeerOfDay();
    return NextResponse.json({ beerOfDay });
  } catch {
    return NextResponse.json({ beerOfDay: null });
  }
}
