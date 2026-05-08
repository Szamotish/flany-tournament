import { supabaseServer } from "@/lib/supabaseServer";
import { isIP } from "node:net";

type BanRow = {
  id: string;
  reason: string | null;
  expires_at: string | null;
};

export function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeIp(value: unknown): string | null {
  const ip = String(value ?? "").trim();
  if (!ip || ip.toLowerCase() === "unknown") return null;
  return isIP(ip) ? ip : null;
}

export async function findActiveEmailBan(email: string): Promise<BanRow | null> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const { data, error } = await supabaseServer
    .from("bans")
    .select("id,reason,expires_at,revoked_at,created_at")
    .eq("email_normalized", normalizedEmail)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("bans") || msg.includes("email_normalized") || msg.includes("revoked_at")) {
      throw new Error("missing_bans_schema");
    }
    throw new Error(msg);
  }

  const nowTs = Date.now();
  const active = (data ?? []).find((row) => {
    const expiresAtRaw = (row as { expires_at?: string | null }).expires_at;
    if (!expiresAtRaw) return true;
    const expiresTs = Date.parse(expiresAtRaw);
    if (!Number.isFinite(expiresTs)) return true;
    return expiresTs > nowTs;
  });

  if (!active) return null;
  return {
    id: String((active as { id?: string }).id ?? ""),
    reason: (active as { reason?: string | null }).reason ?? null,
    expires_at: (active as { expires_at?: string | null }).expires_at ?? null,
  };
}

export async function findActiveIpBan(ip: string): Promise<BanRow | null> {
  const normalizedIp = normalizeIp(ip);
  if (!normalizedIp) return null;

  const { data, error } = await supabaseServer
    .from("ip_bans")
    .select("id,reason,expires_at,revoked_at,created_at")
    .eq("ip_address", normalizedIp)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("ip_bans") || msg.includes("ip_address") || msg.includes("revoked_at")) {
      throw new Error("missing_ip_bans_schema");
    }
    throw new Error(msg);
  }

  const nowTs = Date.now();
  const active = (data ?? []).find((row) => {
    const expiresAtRaw = (row as { expires_at?: string | null }).expires_at;
    if (!expiresAtRaw) return true;
    const expiresTs = Date.parse(expiresAtRaw);
    if (!Number.isFinite(expiresTs)) return true;
    return expiresTs > nowTs;
  });

  if (!active) return null;
  return {
    id: String((active as { id?: string }).id ?? ""),
    reason: (active as { reason?: string | null }).reason ?? null,
    expires_at: (active as { expires_at?: string | null }).expires_at ?? null,
  };
}
