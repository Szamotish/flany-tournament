import { NextResponse } from "next/server";
import { assertMainAdmin } from "@/app/api/admin/_auth";
import { supabaseServer } from "@/lib/supabaseServer";

export async function POST(req: Request) {
  const admin = await assertMainAdmin(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? "").trim();

  if (!name) return NextResponse.json({ error: "missing_name" }, { status: 400 });
  if (name.length > 40) return NextResponse.json({ error: "name_too_long" }, { status: 400 });

  const { data, error } = await supabaseServer
    .from("players")
    .insert({ name, active: true })
    .select("id,name,active")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ player: data });
}
