import { NextResponse } from "next/server";
import { readAuthContext } from "@/app/api/admin/_auth";
import { isBugReportTopic } from "@/lib/bugReports";
import { supabaseServer } from "@/lib/supabaseServer";

export async function POST(req: Request) {
  const auth = await readAuthContext(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.ctx.playerId) return NextResponse.json({ error: "missing_player_profile" }, { status: 403 });

  let body: { topic?: unknown; description?: unknown } = {};
  try {
    body = (await req.json()) as { topic?: unknown; description?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!isBugReportTopic(body.topic)) {
    return NextResponse.json({ error: "invalid_bug_report_topic" }, { status: 400 });
  }

  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description) {
    return NextResponse.json({ error: "missing_bug_report_description" }, { status: 400 });
  }
  if (description.length > 5000) {
    return NextResponse.json({ error: "bug_report_description_too_long" }, { status: 400 });
  }

  const ins = await supabaseServer
    .from("bug_reports")
    .insert({
      reporter_player_id: auth.ctx.playerId,
      reporter_name_snapshot: auth.ctx.playerName ?? "Zawodnik",
      topic: body.topic,
      description,
      status: "open",
    })
    .select("id")
    .single();

  if (ins.error) {
    if (ins.error.message.includes("bug_reports")) {
      return NextResponse.json({ error: "missing_bug_reports_schema" }, { status: 500 });
    }
    return NextResponse.json({ error: ins.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, reportId: String(ins.data.id) });
}

