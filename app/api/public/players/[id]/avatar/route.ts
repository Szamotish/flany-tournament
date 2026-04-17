import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

const MAX_BYTES = 3 * 1024 * 1024; 
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

function extFromMime(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "bin";
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: playerId } = await params;

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
    .select("id")
    .eq("id", playerId)
    .maybeSingle();

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!p?.id) return NextResponse.json({ error: "player_not_found" }, { status: 404 });

  const ext = extFromMime(file.type);
  const path = `players/${playerId}/${crypto.randomUUID()}.${ext}`;

  const bytes = new Uint8Array(await file.arrayBuffer());

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

  return NextResponse.json({ ok: true, avatarUrl });
}