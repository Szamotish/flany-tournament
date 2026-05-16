import { NextResponse } from "next/server";
import { readAuthContext } from "@/app/api/admin/_auth";
import { supabaseServer } from "@/lib/supabaseServer";

type TournamentMeta = {
  id: string;
  name: string;
  event_at: string | null;
  event_location: string | null;
};

type PlayerMeta = {
  id: string;
  name: string;
  avatar_url: string | null;
};

type BugReportRow = {
  id: string;
  reporter_player_id: string | null;
  reporter_name_snapshot: string;
  topic: string;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_reply_at: string | null;
};

type BugReplyRow = {
  id: string;
  report_id: string;
  sender_player_id: string | null;
  sender_role: "main_admin" | "player";
  message: string;
  created_at: string;
};

export async function GET(req: Request) {
  const auth = await readAuthContext(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.ctx.playerId) return NextResponse.json({ error: "missing_player_profile" }, { status: 403 });

  const playerId = auth.ctx.playerId;

  const [incomingInvites, sentJoinRequests, sentInvites, adminTournaments] = await Promise.all([
    supabaseServer
      .from("tournament_invites")
      .select("id,status,created_at,resolved_at,tournament_id,player_id,invited_by_player_id")
      .eq("player_id", playerId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabaseServer
      .from("tournament_join_requests")
      .select("id,status,created_at,resolved_at,tournament_id,player_id")
      .eq("player_id", playerId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabaseServer
      .from("tournament_invites")
      .select("id,status,created_at,resolved_at,tournament_id,player_id,invited_by_player_id")
      .eq("invited_by_player_id", playerId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabaseServer.from("tournament_admins").select("tournament_id").eq("player_id", playerId),
  ]);

  if (incomingInvites.error && incomingInvites.error.message.includes("tournament_invites")) {
    return NextResponse.json({ error: "missing_invites_schema" }, { status: 500 });
  }
  if (sentJoinRequests.error && sentJoinRequests.error.message.includes("tournament_join_requests")) {
    return NextResponse.json({ error: "missing_join_requests_schema" }, { status: 500 });
  }
  if (incomingInvites.error) return NextResponse.json({ error: incomingInvites.error.message }, { status: 500 });
  if (sentJoinRequests.error) return NextResponse.json({ error: sentJoinRequests.error.message }, { status: 500 });
  if (sentInvites.error && !sentInvites.error.message.includes("tournament_invites")) {
    return NextResponse.json({ error: sentInvites.error.message }, { status: 500 });
  }
  if (adminTournaments.error && !adminTournaments.error.message.includes("tournament_admins")) {
    return NextResponse.json({ error: adminTournaments.error.message }, { status: 500 });
  }

  const adminTournamentIds = Array.from(
    new Set((adminTournaments.data ?? []).map((row) => String(row.tournament_id ?? "")).filter(Boolean))
  );

  const adminJoinRequestsRes =
    adminTournamentIds.length > 0
      ? await supabaseServer
          .from("tournament_join_requests")
          .select("id,status,created_at,resolved_at,tournament_id,player_id,resolved_by_player_id")
          .in("tournament_id", adminTournamentIds)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(120)
      : { data: [], error: null };

  if (
    adminJoinRequestsRes.error &&
    !adminJoinRequestsRes.error.message.includes("tournament_join_requests")
  ) {
    return NextResponse.json({ error: adminJoinRequestsRes.error.message }, { status: 500 });
  }

  const bugReportsRes = auth.ctx.isMainAdmin
    ? await supabaseServer
        .from("bug_reports")
        .select("id,reporter_player_id,reporter_name_snapshot,topic,description,status,created_at,updated_at,last_reply_at")
        .order("created_at", { ascending: false })
        .limit(160)
    : await supabaseServer
        .from("bug_reports")
        .select("id,reporter_player_id,reporter_name_snapshot,topic,description,status,created_at,updated_at,last_reply_at")
        .eq("reporter_player_id", playerId)
        .order("created_at", { ascending: false })
        .limit(160);

  if (bugReportsRes.error) {
    if (bugReportsRes.error.message.includes("bug_reports")) {
      return NextResponse.json({ error: "missing_bug_reports_schema" }, { status: 500 });
    }
    return NextResponse.json({ error: bugReportsRes.error.message }, { status: 500 });
  }

  const bugReportIds = Array.from(
    new Set((bugReportsRes.data ?? []).map((row) => String(row.id ?? "")).filter(Boolean))
  );

  const bugRepliesRes =
    bugReportIds.length > 0
      ? await supabaseServer
          .from("bug_report_replies")
          .select("id,report_id,sender_player_id,sender_role,message,created_at")
          .in("report_id", bugReportIds)
          .order("created_at", { ascending: true })
          .limit(1200)
      : { data: [], error: null };

  if (bugRepliesRes.error) {
    if (bugRepliesRes.error.message.includes("bug_report_replies")) {
      return NextResponse.json({ error: "missing_bug_reports_schema" }, { status: 500 });
    }
    return NextResponse.json({ error: bugRepliesRes.error.message }, { status: 500 });
  }

  const allTournamentIds = Array.from(
    new Set(
      [
        ...(incomingInvites.data ?? []).map((row) => String(row.tournament_id ?? "")),
        ...(sentJoinRequests.data ?? []).map((row) => String(row.tournament_id ?? "")),
        ...(sentInvites.data ?? []).map((row) => String(row.tournament_id ?? "")),
        ...(adminJoinRequestsRes.data ?? []).map((row) => String(row.tournament_id ?? "")),
      ].filter(Boolean)
    )
  );

  const allPlayerIds = Array.from(
    new Set(
      [
        ...(incomingInvites.data ?? []).flatMap((row) => [
          String(row.player_id ?? ""),
          String(row.invited_by_player_id ?? ""),
        ]),
        ...(sentInvites.data ?? []).flatMap((row) => [
          String(row.player_id ?? ""),
          String(row.invited_by_player_id ?? ""),
        ]),
        ...(adminJoinRequestsRes.data ?? []).map((row) => String(row.player_id ?? "")),
        ...(bugReportsRes.data ?? []).map((row) => String(row.reporter_player_id ?? "")),
        ...(bugRepliesRes.data ?? []).map((row) => String(row.sender_player_id ?? "")),
      ].filter(Boolean)
    )
  );

  const [tournamentsMetaRes, playersMetaRes] = await Promise.all([
    allTournamentIds.length > 0
      ? supabaseServer
          .from("tournaments")
          .select("id,name,event_at,event_location")
          .in("id", allTournamentIds)
      : Promise.resolve({ data: [], error: null }),
    allPlayerIds.length > 0
      ? supabaseServer
          .from("players")
          .select("id,name,avatar_url")
          .in("id", allPlayerIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (tournamentsMetaRes.error) return NextResponse.json({ error: tournamentsMetaRes.error.message }, { status: 500 });
  if (playersMetaRes.error) return NextResponse.json({ error: playersMetaRes.error.message }, { status: 500 });

  const tournamentMap = new Map<string, TournamentMeta>();
  for (const row of tournamentsMetaRes.data ?? []) {
    tournamentMap.set(String(row.id), {
      id: String(row.id),
      name: String(row.name ?? "Turniej"),
      event_at: row.event_at ? String(row.event_at) : null,
      event_location: row.event_location ? String(row.event_location) : null,
    });
  }

  const playerMap = new Map<string, PlayerMeta>();
  for (const row of playersMetaRes.data ?? []) {
    playerMap.set(String(row.id), {
      id: String(row.id),
      name: String(row.name ?? "Zawodnik"),
      avatar_url: typeof row.avatar_url === "string" ? row.avatar_url : null,
    });
  }

  const incomingInviteItems = (incomingInvites.data ?? []).map((row) => ({
    ...row,
    tournaments: tournamentMap.get(String(row.tournament_id ?? "")) ?? null,
    inviter: playerMap.get(String(row.invited_by_player_id ?? "")) ?? null,
  }));

  const sentJoinItems = (sentJoinRequests.data ?? []).map((row) => ({
    ...row,
    tournaments: tournamentMap.get(String(row.tournament_id ?? "")) ?? null,
  }));

  const sentInviteItems = (sentInvites.data ?? []).map((row) => ({
    ...row,
    tournaments: tournamentMap.get(String(row.tournament_id ?? "")) ?? null,
    players: playerMap.get(String(row.player_id ?? "")) ?? null,
  }));

  const adminRequestItems = (adminJoinRequestsRes.data ?? []).map((row) => ({
    ...row,
    tournaments: tournamentMap.get(String(row.tournament_id ?? "")) ?? null,
    players: playerMap.get(String(row.player_id ?? "")) ?? null,
  }));

  const bugRepliesByReport = new Map<string, Array<BugReplyRow & { sender: PlayerMeta | null }>>();
  for (const row of (bugRepliesRes.data ?? []) as BugReplyRow[]) {
    const reportId = String(row.report_id ?? "");
    if (!reportId) continue;
    const existing = bugRepliesByReport.get(reportId) ?? [];
    existing.push({
      ...row,
      sender: row.sender_player_id ? playerMap.get(String(row.sender_player_id)) ?? null : null,
    });
    bugRepliesByReport.set(reportId, existing);
  }

  const bugReportItems = (bugReportsRes.data ?? []).map((row) => {
    const bugRow = row as BugReportRow;
    const reporter = bugRow.reporter_player_id
      ? playerMap.get(String(bugRow.reporter_player_id)) ?? null
      : null;
    return {
      ...bugRow,
      reporter: reporter ?? {
        id: "",
        name: bugRow.reporter_name_snapshot || "Zawodnik",
        avatar_url: null,
      },
      replies: bugRepliesByReport.get(String(bugRow.id)) ?? [],
    };
  });

  const bugInboxReplies = auth.ctx.isMainAdmin
    ? []
    : bugReportItems
        .flatMap((report) => report.replies.map((reply) => ({ report, reply })))
        .filter((item) => item.reply.sender_role === "main_admin")
        .sort((a, b) => b.reply.created_at.localeCompare(a.reply.created_at));

  return NextResponse.json({
    incomingInvites: incomingInviteItems,
    sentJoinRequests: sentJoinItems,
    sentInvites: sentInviteItems,
    adminJoinRequests: adminRequestItems,
    bugReports: bugReportItems,
    bugInboxReplies,
  });
}
