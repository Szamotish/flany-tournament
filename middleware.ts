import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), payment=(), usb=(), geolocation=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self)"
  );

  const isDev = req.nextUrl.hostname === "localhost" || req.nextUrl.hostname === "127.0.0.1";
  const connectSrc = [
    "'self'",
    "https://*.supabase.co",
    "https://api.open-meteo.com",
    "https://overpass-api.de",
    "https://lz4.overpass-api.de",
    "https://z.overpass-api.de",
    "https://overpass.kumi.systems",
    "https://overpass.openstreetmap.ru",
    "https://overpass.private.coffee",
    "https://challenges.cloudflare.com",
  ];
  if (isDev) connectSrc.push("ws:", "http://localhost:*");

  res.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "img-src 'self' data: blob: https://*.supabase.co",
      "font-src 'self' https://fonts.gstatic.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://unpkg.com",
      "frame-src https://challenges.cloudflare.com",
      `connect-src ${connectSrc.join(" ")}`,
    ].join("; ")
  );

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|models|ramki).*)"],
};
