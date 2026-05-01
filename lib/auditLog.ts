import { supabaseServer } from "@/lib/supabaseServer";

type AuditLogInput = {
  actorUserId?: string | null;
  actorPlayerId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  const res = await supabaseServer.from("admin_audit_log").insert({
    actor_user_id: input.actorUserId ?? null,
    actor_player_id: input.actorPlayerId ?? null,
    action: input.action,
    target_type: input.targetType,
    target_id: input.targetId ?? null,
    metadata: input.metadata ?? {},
  });

  // The app must keep working until the migration is applied.
  if (res.error && !res.error.message.includes("admin_audit_log")) {
    console.error("audit_log_write_failed", res.error.message);
  }
}
