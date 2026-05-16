import { NextResponse } from "next/server";
import { readConfiguredBeerOfDay } from "@/lib/appBackground";

export async function GET() {
  const beerOfDay = await readConfiguredBeerOfDay();
  return NextResponse.json({ beerOfDay });
}

