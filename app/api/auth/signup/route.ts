import { NextResponse } from "next/server";
import { findActiveEmailBan, findActiveIpBan } from "@/lib/bans";
import { supabasePublic } from "@/lib/supabasePublic";
import { supabaseServer } from "@/lib/supabaseServer";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { verifyTurnstile } from "@/lib/turnstile";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PSEUDONYM_RE = /^[\p{L}\p{N}._ -]{2,40}$/u;

function normalizePseudo(value: unknown): string {
  return String(value ?? "").trim().slice(0, 40);
}

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

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const pseudonym = normalizePseudo(body?.pseudonym);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const ip = clientIp(req);
  const origin = appOrigin(req);
  const turnstileToken = String(body?.turnstileToken ?? "");

  const ipLimit = rateLimit({ key: `signup:ip:${ip}`, limit: 8, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);
  const emailLimit = rateLimit({ key: `signup:email:${email}`, limit: 3, windowMs: 60 * 60 * 1000 });
  if (!emailLimit.ok) return rateLimitResponse(emailLimit);

  const captcha = await verifyTurnstile(turnstileToken, ip);
  if (!captcha.ok) {
    return NextResponse.json({ error: captcha.error }, { status: 400 });
  }

  if (!PSEUDONYM_RE.test(pseudonym)) {
    return NextResponse.json({ error: "invalid_pseudonym" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  try {
    const activeIpBan = await findActiveIpBan(ip);
    if (activeIpBan) {
      return NextResponse.json(
        {
          error: "banned_ip",
          reason: activeIpBan.reason,
          expiresAt: activeIpBan.expires_at,
        },
        { status: 403 }
      );
    }

    const activeBan = await findActiveEmailBan(email);
    if (activeBan) {
      return NextResponse.json(
        {
          error: "banned_email",
          reason: activeBan.reason,
          expiresAt: activeBan.expires_at,
        },
        { status: 403 }
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "ban_check_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "password_too_short" }, { status: 400 });
  }

  const duplicateNameCheck = await supabaseServer
    .from("players")
    .select("id")
    .ilike("name", pseudonym)
    .limit(1);

  if (duplicateNameCheck.error) {
    return NextResponse.json({ error: duplicateNameCheck.error.message }, { status: 500 });
  }
  if ((duplicateNameCheck.data ?? []).length > 0) {
    return NextResponse.json({ error: "pseudonym_taken" }, { status: 409 });
  }

  const signUp = await supabasePublic.auth.signUp({
    email,
    password,
    options: {
      data: { pseudonym },
      emailRedirectTo: `${origin}/auth?confirmed=1`,
    },
  });

  if (signUp.error || !signUp.data.user?.id) {
    return NextResponse.json({ error: signUp.error?.message ?? "signup_failed" }, { status: 400 });
  }

  const userId = signUp.data.user.id;

  const existingPlayer = await supabaseServer
    .from("players")
    .select("id,name")
    .eq("auth_user_id", userId)
    .maybeSingle();

  if (existingPlayer.error) {
    if (existingPlayer.error.message.includes("auth_user_id")) {
      return NextResponse.json({ error: "missing_auth_schema" }, { status: 500 });
    }
    return NextResponse.json({ error: existingPlayer.error.message }, { status: 500 });
  }

  if (existingPlayer.data) {
    return NextResponse.json({
      ok: true,
      player: existingPlayer.data,
      requiresEmailConfirmation: !signUp.data.session,
    });
  }

  const createdPlayer = await supabaseServer
    .from("players")
    .insert({
      name: pseudonym,
      active: true,
      auth_user_id: userId,
      rank_frame_enabled: true,
    })
    .select("id,name,active")
    .single();

  if (createdPlayer.error) {
    await supabaseServer.auth.admin.deleteUser(userId);
    if (createdPlayer.error.message.includes("auth_user_id")) {
      return NextResponse.json({ error: "missing_auth_schema" }, { status: 500 });
    }
    if (createdPlayer.error.code === "23505") {
      return NextResponse.json({ error: "pseudonym_taken" }, { status: 409 });
    }
    return NextResponse.json({ error: createdPlayer.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    player: createdPlayer.data,
    requiresEmailConfirmation: !signUp.data.session,
  });
}
