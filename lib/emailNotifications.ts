import { supabaseServer } from "@/lib/supabaseServer";

type EmailRecipient = {
  email: string;
  name?: string | null;
};

type SendEmailInput = {
  to: EmailRecipient[];
  subject: string;
  html: string;
  text: string;
};

type PlayerEmailTarget = {
  id: string;
  name: string | null;
  auth_user_id: string | null;
  email_notifications_enabled?: boolean | null;
};

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || "https://flany-tournament.com").replace(/\/+$/, "");
}

function sender() {
  return {
    email: process.env.EMAIL_FROM || "no-reply@flany-tournament.com",
    name: process.env.EMAIL_FROM_NAME || "Flany Tournament",
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function sendTransactionalEmail(input: SendEmailInput): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV !== "production") {
      console.log("email_notification_skipped_missing_brevo_key", input.subject, input.to);
    }
    return;
  }

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: sender(),
      to: input.to.map((recipient) => ({
        email: recipient.email,
        name: recipient.name || undefined,
      })),
      subject: input.subject,
      htmlContent: input.html,
      textContent: input.text,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`brevo_send_failed:${res.status}:${detail.slice(0, 300)}`);
  }
}

export async function sendPasswordResetEmail(input: {
  email: string;
  resetLink: string;
}): Promise<void> {
  const link = escapeHtml(input.resetLink);

  await sendTransactionalEmail({
    to: [{ email: input.email }],
    subject: "Reset hasla - Flany Tournament",
    text: `Aby ustawic nowe haslo, wejdz w link: ${input.resetLink}. Jesli to nie Ty prosiles o reset hasla, zignoruj ta wiadomosc.`,
    html: `
      <p>Otrzymalismy prosbe o reset hasla do konta Flany Tournament.</p>
      <p><a href="${link}">Ustaw nowe haslo</a></p>
      <p>Jesli to nie Ty prosiles o reset hasla, zignoruj ta wiadomosc.</p>
    `,
  });
}

async function playerRecipients(players: PlayerEmailTarget[]): Promise<EmailRecipient[]> {
  const eligible = players.filter(
    (player) => player.auth_user_id && player.email_notifications_enabled === true
  );
  if (eligible.length === 0) return [];

  const recipients: EmailRecipient[] = [];
  for (const player of eligible) {
    const userRes = await supabaseServer.auth.admin.getUserById(String(player.auth_user_id));
    const email = userRes.data.user?.email;
    if (userRes.error || !email) continue;
    recipients.push({ email, name: player.name });
  }
  return recipients;
}

async function safeSend(input: SendEmailInput): Promise<void> {
  if (input.to.length === 0) return;
  try {
    await sendTransactionalEmail(input);
  } catch (error) {
    console.error("email_notification_failed", error instanceof Error ? error.message : error);
  }
}

export async function notifyTournamentInvite(input: {
  invitedPlayerId: string;
  inviterName: string | null;
  tournamentId: string;
  tournamentName: string;
}): Promise<void> {
  const playerRes = await supabaseServer
    .from("players")
    .select("id,name,auth_user_id,email_notifications_enabled")
    .eq("id", input.invitedPlayerId)
    .maybeSingle();

  if (playerRes.error || !playerRes.data) return;
  const recipients = await playerRecipients([playerRes.data as PlayerEmailTarget]);
  const link = `${siteUrl()}/tournaments/${input.tournamentId}`;
  const tournamentName = escapeHtml(input.tournamentName);
  const inviterName = escapeHtml(input.inviterName || "Admin turnieju");

  await safeSend({
    to: recipients,
    subject: `Zaproszenie do turnieju: ${input.tournamentName}`,
    text: `${input.inviterName || "Admin turnieju"} zaprosil Cie do turnieju "${input.tournamentName}". Wejdz: ${link}`,
    html: `
      <p><strong>${inviterName}</strong> zaprosil Cie do turnieju <strong>${tournamentName}</strong>.</p>
      <p><a href="${link}">Otworz turniej</a></p>
    `,
  });
}

export async function notifyTournamentJoinRequest(input: {
  requesterName: string | null;
  tournamentId: string;
  tournamentName: string;
}): Promise<void> {
  const adminsRes = await supabaseServer
    .from("tournament_admins")
    .select("players(id,name,auth_user_id,email_notifications_enabled)")
    .eq("tournament_id", input.tournamentId);

  if (adminsRes.error) return;

  const players = (adminsRes.data ?? [])
    .map((row) => {
      const source = (row as { players?: unknown }).players;
      return Array.isArray(source) ? source[0] : source;
    })
    .filter(Boolean) as PlayerEmailTarget[];

  const recipients = await playerRecipients(players);
  const link = `${siteUrl()}/tournaments/${input.tournamentId}/admin`;
  const tournamentName = escapeHtml(input.tournamentName);
  const requesterName = escapeHtml(input.requesterName || "Zawodnik");

  await safeSend({
    to: recipients,
    subject: `Nowa prosba o dolaczenie: ${input.tournamentName}`,
    text: `${input.requesterName || "Zawodnik"} poprosil o dolaczenie do turnieju "${input.tournamentName}". Panel admina: ${link}`,
    html: `
      <p><strong>${requesterName}</strong> poprosil o dolaczenie do turnieju <strong>${tournamentName}</strong>.</p>
      <p><a href="${link}">Otworz panel admina turnieju</a></p>
    `,
  });
}

export async function notifyJoinRequestDecision(input: {
  playerId: string;
  tournamentId: string;
  tournamentName: string;
  accepted: boolean;
}): Promise<void> {
  const playerRes = await supabaseServer
    .from("players")
    .select("id,name,auth_user_id,email_notifications_enabled")
    .eq("id", input.playerId)
    .maybeSingle();

  if (playerRes.error || !playerRes.data) return;
  const recipients = await playerRecipients([playerRes.data as PlayerEmailTarget]);
  const link = `${siteUrl()}/tournaments/${input.tournamentId}`;
  const tournamentName = escapeHtml(input.tournamentName);
  const status = input.accepted ? "zaakceptowana" : "odrzucona";

  await safeSend({
    to: recipients,
    subject: `Twoja prosba zostala ${status}: ${input.tournamentName}`,
    text: `Twoja prosba o dolaczenie do turnieju "${input.tournamentName}" zostala ${status}. Szczegoly: ${link}`,
    html: `
      <p>Twoja prosba o dolaczenie do turnieju <strong>${tournamentName}</strong> zostala <strong>${status}</strong>.</p>
      <p><a href="${link}">Otworz turniej</a></p>
    `,
  });
}
