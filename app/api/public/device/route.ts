import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";

export async function GET() {
  const jar = await cookies();
  let deviceId = jar.get("device_id")?.value;

  if (!deviceId) {
    deviceId = randomUUID();
    jar.set("device_id", deviceId, {
      httpOnly: true,
      sameSite: "lax",
      secure: false, 
      path: "/",
      maxAge: 60 * 60 * 24 * 365, 
    });
  }

  return NextResponse.json({ deviceId });
}