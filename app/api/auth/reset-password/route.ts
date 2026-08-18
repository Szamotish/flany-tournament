import { NextResponse } from "next/server";
import { supabasePublic } from "@/lib/supabasePublic";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { verifyTurnstile } from "@/lib/turnstile";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function appOrigin(req: Request): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL;
  if (siteUrl) return siteUrl.replace(/\/+$/, "");

  const requestOrigin = req.headers.get("origin") ?? new URL(req.url).origin;
  const allowed = new Set([
    "https://flany-tournament.com",
    "https://www.flany-tournament.com",
    "http://localhost:3000",
  ]);

  return allowed.has(requestOrigin) ? requestOrigin : "https://flany-tournament.com";
}

function isSupabaseResetCooldown(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("security purposes") ||
    normalized.includes("only request this after") ||
    normalized.includes("rate limit")
  );
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const turnstileToken = String(body?.turnstileToken ?? "");
  const ip = clientIp(req);

  const ipLimit = rateLimit({ key: `password-reset:ip:${ip}`, limit: 5, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);

  const emailLimit = rateLimit({ key: `password-reset:email:${email}`, limit: 3, windowMs: 60 * 60 * 1000 });
  if (!emailLimit.ok) return rateLimitResponse(emailLimit);

  const captcha = await verifyTurnstile(turnstileToken, ip);
  if (!captcha.ok) {
    return NextResponse.json({ error: captcha.error }, { status: 400 });
  }

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const redirectTo = `${appOrigin(req)}/auth/reset`;
  const resetRes = await supabasePublic.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (resetRes.error) {
    const message = resetRes.error.message || "unknown";
    if (isSupabaseResetCooldown(message)) {
      return NextResponse.json({ error: "reset_cooldown" }, { status: 429 });
    }
    console.error("password_reset_supabase_failed", message);
    return NextResponse.json({ error: "email_send_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
