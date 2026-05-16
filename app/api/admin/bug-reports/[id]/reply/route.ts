import { NextResponse } from "next/server";
import { assertMainAdmin } from "@/app/api/admin/_auth";
import { supabaseServer } from "@/lib/supabaseServer";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const admin = await assertMainAdmin(req);
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const { id } = await params;
  const reportId = String(id ?? "").trim();
  if (!reportId) return NextResponse.json({ error: "missing_report_id" }, { status: 400 });

  let body: { message?: unknown } = {};
  try {
    body = (await req.json()) as { message?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "missing_reply_message" }, { status: 400 });
  if (message.length > 3000) return NextResponse.json({ error: "reply_message_too_long" }, { status: 400 });

  const report = await supabaseServer
    .from("bug_reports")
    .select("id,reporter_player_id")
    .eq("id", reportId)
    .maybeSingle();

  if (report.error) {
    if (report.error.message.includes("bug_reports")) {
      return NextResponse.json({ error: "missing_bug_reports_schema" }, { status: 500 });
    }
    return NextResponse.json({ error: report.error.message }, { status: 500 });
  }
  if (!report.data) return NextResponse.json({ error: "bug_report_not_found" }, { status: 404 });

  const ins = await supabaseServer
    .from("bug_report_replies")
    .insert({
      report_id: reportId,
      sender_player_id: admin.ctx.playerId,
      sender_role: "main_admin",
      message,
    })
    .select("id,created_at")
    .single();

  if (ins.error) {
    if (ins.error.message.includes("bug_report_replies")) {
      return NextResponse.json({ error: "missing_bug_reports_schema" }, { status: 500 });
    }
    return NextResponse.json({ error: ins.error.message }, { status: 500 });
  }

  const touch = await supabaseServer
    .from("bug_reports")
    .update({
      updated_at: new Date().toISOString(),
      last_reply_at: ins.data.created_at,
    })
    .eq("id", reportId);

  if (touch.error && !touch.error.message.includes("bug_reports")) {
    return NextResponse.json({ error: touch.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, replyId: String(ins.data.id) });
}

