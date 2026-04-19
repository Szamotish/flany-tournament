function normalizeSecret(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed.replace(/^['"]|['"]$/g, "");
}

export function assertMainAdmin(req: Request) {
  const pass = normalizeSecret(req.headers.get("x-admin-password"));
  const adminPassword = normalizeSecret(process.env.ADMIN_PASSWORD);

  return Boolean(pass) && Boolean(adminPassword) && pass === adminPassword;
}
