import { NextResponse } from "next/server";
import { readAppBackground } from "@/lib/appBackground";

export async function GET() {
  try {
    const background = await readAppBackground();
    return NextResponse.json({ background });
  } catch {
    return NextResponse.json({ background: "finn_bmo" });
  }
}
