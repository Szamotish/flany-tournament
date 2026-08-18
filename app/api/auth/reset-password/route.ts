import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabasePublic } from "@/lib/supabasePublic";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { verifyTurnstile } from "@/lib/turnstile";
import { sendPasswordResetEmail } from "@/lib/emailNotifications";

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

function okResponse() {
  return NextResponse.json({ ok: true });
}

async function sendSupabasePasswordReset(email: string, redirectTo: string): Promise<void> {
  const { error } = await supabasePublic.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (error) {
    throw new Error(`supabase_reset_failed:${error.message}`);
  }
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
  const linkRes = await supabaseServer.auth.admin.generateLink({
    type: "recovery",
    email,
    options: {
      redirectTo,
    },
  });

  const actionLink = linkRes.data?.properties?.action_link;

  if (linkRes.error || !actionLink) {
    // Do not reveal whether the account exists.
    console.warn("password_reset_link_not_generated", linkRes.error?.message ?? "missing_action_link");
    return okResponse();
  }

  try {
    await sendPasswordResetEmail({ email, resetLink: actionLink });
  } catch (error) {
    console.error("password_reset_email_failed", error instanceof Error ? error.message : error);

    try {
      await sendSupabasePasswordReset(email, redirectTo);
      return okResponse();
    } catch (fallbackError) {
      console.error(
        "password_reset_supabase_fallback_failed",
        fallbackError instanceof Error ? fallbackError.message : fallbackError
      );
      return NextResponse.json({ error: "email_send_failed" }, { status: 500 });
    }
  }

  return okResponse();
}
