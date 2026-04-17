import { NextResponse } from "next/server";
import { readAppBackground } from "@/lib/appBackground";

export async function GET() {
  const background = await readAppBackground();
  return NextResponse.json({ background });
}
