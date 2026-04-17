export function assertMainAdmin(req: Request) {
  const pass = req.headers.get("x-admin-password");
  return Boolean(pass) && pass === process.env.ADMIN_PASSWORD;
}
