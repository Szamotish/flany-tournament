import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { readAuthContext } from "@/app/api/admin/_auth";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rateLimit";

const MAX_BYTES = 3 * 1024 * 1024; 
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

function extFromMime(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "bin";
}

function looksLikeAllowedImage(bytes: Uint8Array, mime: string): boolean {
  if (mime === "image/png") {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (mime === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === "image/webp") {
    return (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  return false;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ip = clientIp(req);
  const ipLimit = rateLimit({ key: `avatar:ip:${ip}`, limit: 20, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);

  const auth = await readAuthContext(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: playerId } = await params;
  const canEdit = auth.ctx.isMainAdmin || auth.ctx.playerId === playerId;
  if (!canEdit) {
    return NextResponse.json({ error: "forbidden_player_owner_only" }, { status: 403 });
  }
  const userLimit = rateLimit({ key: `avatar:user:${auth.ctx.userId}`, limit: 6, windowMs: 10 * 60 * 1000 });
  if (!userLimit.ok) return rateLimitResponse(userLimit);

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid_formdata" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }

  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "invalid_type", allowed: Array.from(ALLOWED) }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "too_large", maxBytes: MAX_BYTES }, { status: 400 });
  }

  const { data: p, error: pErr } = await supabaseServer
    .from("players")
    .select("id,avatar_url")
    .eq("id", playerId)
    .maybeSingle();

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!p?.id) return NextResponse.json({ error: "player_not_found" }, { status: 404 });

  const ext = extFromMime(file.type);
  const path = `players/${playerId}/${crypto.randomUUID()}.${ext}`;

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikeAllowedImage(bytes, file.type)) {
    return NextResponse.json({ error: "invalid_image_signature" }, { status: 400 });
  }

  const { error: upErr } = await supabaseServer.storage
    .from("avatars")
    .upload(path, bytes, { contentType: file.type, upsert: true });

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data: pub } = supabaseServer.storage.from("avatars").getPublicUrl(path);
  const avatarUrl = pub.publicUrl;

  const { error: saveErr } = await supabaseServer
    .from("players")
    .update({ avatar_url: avatarUrl })
    .eq("id", playerId);

  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 });

  const previousUrl = typeof p.avatar_url === "string" ? p.avatar_url : "";
  const previousMarker = "/storage/v1/object/public/avatars/";
  const previousPath = previousUrl.includes(previousMarker)
    ? decodeURIComponent(previousUrl.split(previousMarker)[1] ?? "")
    : "";
  if (previousPath && previousPath !== path) {
    await supabaseServer.storage.from("avatars").remove([previousPath]);
  }

  return NextResponse.json({ ok: true, avatarUrl });
}
