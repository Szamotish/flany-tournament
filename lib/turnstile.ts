type TurnstileResponse = {
  success?: boolean;
  "error-codes"?: string[];
};

export async function verifyTurnstile(token: string, ip: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (process.env.NODE_ENV !== "production") return { ok: true };
    return { ok: false, error: "turnstile_not_configured" };
  }
  if (!token) {
    return { ok: false, error: "missing_turnstile_token" };
  }

  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  if (ip && ip !== "unknown") form.set("remoteip", ip);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
    cache: "no-store",
  });

  if (!res.ok) {
    return { ok: false, error: "turnstile_verify_failed" };
  }

  const json = (await res.json().catch(() => ({}))) as TurnstileResponse;
  if (json.success === true) return { ok: true };

  return {
    ok: false,
    error: json["error-codes"]?.join(",") || "turnstile_rejected",
  };
}
