"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { authedFetch } from "@/lib/authClient";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

type AuthState = {
  loading: boolean;
  authenticated: boolean;
  playerId: string | null;
  playerName: string | null;
  email: string | null;
  isMainAdmin: boolean;
};

type NotificationsPayload = {
  incomingInvites: Array<{
    id: string;
    status: string;
    created_at: string;
    tournament_id: string;
    tournaments?: { id?: string; name?: string } | null;
    inviter?: { id?: string; name?: string } | null;
  }>;
  sentJoinRequests: Array<{
    id: string;
    status: string;
    created_at: string;
    resolved_at?: string | null;
    tournament_id: string;
    tournaments?: { id?: string; name?: string } | null;
  }>;
  sentInvites: Array<{
    id: string;
    status: string;
    created_at: string;
    tournament_id: string;
    tournaments?: { id?: string; name?: string } | null;
    players?: { id?: string; name?: string } | null;
  }>;
  adminJoinRequests: Array<{
    id: string;
    status: string;
    created_at: string;
    tournament_id: string;
    tournaments?: { id?: string; name?: string } | null;
    players?: { id?: string; name?: string } | null;
  }>;
};

async function readAuthState(): Promise<AuthState> {
  const res = await authedFetch("/api/auth/me", { cache: "no-store" });
  const json = await res.json().catch(() => ({}));

  return {
    loading: false,
    authenticated: Boolean(json.authenticated),
    playerId: typeof json.player?.id === "string" ? json.player.id : null,
    playerName: typeof json.player?.name === "string" ? json.player.name : null,
    email: typeof json.user?.email === "string" ? json.user.email : null,
    isMainAdmin: json.isMainAdmin === true,
  };
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "--";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "--";
  return parsed.toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AuthControls() {
  const pathname = usePathname();
  const [auth, setAuth] = useState<AuthState>({
    loading: true,
    authenticated: false,
    playerId: null,
    playerName: null,
    email: null,
    isMainAdmin: false,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [notificationsTab, setNotificationsTab] = useState<"inbox" | "sent">("inbox");
  const [notifications, setNotifications] = useState<NotificationsPayload | null>(null);
  const [notifMsg, setNotifMsg] = useState<string | null>(null);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [localAdminContext, setLocalAdminContext] = useState<{
    tournamentId: string | null;
    isTournamentAdmin: boolean;
  }>({
    tournamentId: null,
    isTournamentAdmin: false,
  });

  const pendingCount = useMemo(() => {
    if (!notifications) return 0;
    const invites = notifications.incomingInvites.filter((x) => x.status === "pending").length;
    const requests = notifications.adminJoinRequests.filter((x) => x.status === "pending").length;
    return invites + requests;
  }, [notifications]);

  useEffect(() => {
    let mounted = true;
    const supabase = getSupabaseBrowserClient();

    void readAuthState().then((state) => {
      if (!mounted) return;
      setAuth(state);
      setNewEmail(state.email ?? "");
    });

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      void readAuthState().then((state) => {
        if (!mounted) return;
        setAuth(state);
        setNewEmail(state.email ?? "");
      });
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const match = pathname.match(/^\/tournaments\/([^/]+)(?:\/.*)?$/);
      if (!auth.authenticated || !match?.[1]) {
        if (!cancelled) {
          setLocalAdminContext({ tournamentId: null, isTournamentAdmin: false });
        }
        return;
      }

      const tournamentId = decodeURIComponent(match[1]);
      const res = await authedFetch(`/api/public/tournaments/${encodeURIComponent(tournamentId)}/membership`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) {
        setLocalAdminContext({ tournamentId, isTournamentAdmin: false });
        return;
      }
      setLocalAdminContext({
        tournamentId,
        isTournamentAdmin: json.isTournamentAdmin === true,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, auth.authenticated]);

  async function logout() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    setAuth({
      loading: false,
      authenticated: false,
      playerId: null,
      playerName: null,
      email: null,
      isMainAdmin: false,
    });
    window.location.href = "/";
  }

  async function openNotificationsModal() {
    setMenuOpen(false);
    setShowNotifications(true);
    setNotifMsg(null);

    const [notificationsRes, settingsRes] = await Promise.all([
      authedFetch("/api/public/notifications", { cache: "no-store" }),
      authedFetch("/api/auth/settings", { cache: "no-store" }),
    ]);

    const notificationsJson = await notificationsRes.json().catch(() => ({}));
    const settingsJson = await settingsRes.json().catch(() => ({}));

    if (notificationsRes.ok) {
      setNotifications(notificationsJson as NotificationsPayload);
    } else {
      setNotifMsg(`Blad powiadomien: ${notificationsJson.error ?? notificationsRes.statusText}`);
    }

    if (settingsRes.ok && typeof settingsJson.emailNotificationsEnabled === "boolean") {
      setEmailNotificationsEnabled(settingsJson.emailNotificationsEnabled);
    }
  }

  async function openSettingsModal() {
    setMenuOpen(false);
    setShowSettings(true);
    setSettingsMsg(null);
    const settingsRes = await authedFetch("/api/auth/settings", { cache: "no-store" });
    const settingsJson = await settingsRes.json().catch(() => ({}));
    if (settingsRes.ok && typeof settingsJson.emailNotificationsEnabled === "boolean") {
      setEmailNotificationsEnabled(settingsJson.emailNotificationsEnabled);
    }
  }

  async function handleInviteDecision(inviteId: string, action: "accept" | "reject") {
    const res = await authedFetch(`/api/public/invites/${inviteId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotifMsg(`Blad zaproszenia: ${json.error ?? res.statusText}`);
      return;
    }
    await openNotificationsModal();
  }

  async function handleAdminRequestDecision(
    tournamentId: string,
    requestId: string,
    action: "accept" | "reject"
  ) {
    const res = await authedFetch(`/api/admin/tournaments/${tournamentId}/requests`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId, action }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotifMsg(`Blad prosby: ${json.error ?? res.statusText}`);
      return;
    }
    await openNotificationsModal();
  }

  async function saveEmailNotificationsPreference(value: boolean) {
    const res = await authedFetch("/api/auth/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emailNotificationsEnabled: value }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSettingsMsg(`Blad ustawien: ${json.error ?? res.statusText}`);
      return;
    }
    setEmailNotificationsEnabled(Boolean(json.emailNotificationsEnabled));
    setSettingsMsg("Zapisano ustawienia powiadomien.");
  }

  async function changeEmail() {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim().toLowerCase() });
    if (error) {
      setSettingsMsg(`Blad zmiany maila: ${error.message}`);
      return;
    }
    setSettingsMsg("Wyslano potwierdzenie zmiany emaila.");
  }

  async function changePassword() {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setSettingsMsg(`Blad zmiany hasla: ${error.message}`);
      return;
    }
    setNewPassword("");
    setSettingsMsg("Haslo zmienione.");
  }

  async function deleteAccount() {
    const ok = window.confirm("Na pewno usunac konto? Operacja jest nieodwracalna.");
    if (!ok) return;
    const res = await authedFetch("/api/auth/account", { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSettingsMsg(`Blad usuwania konta: ${json.error ?? res.statusText}`);
      return;
    }
    await logout();
  }

  if (auth.loading) {
    return (
      <div className="auth-controls">
        <span className="auth-chip">...</span>
      </div>
    );
  }

  if (!auth.authenticated) {
    return (
      <div className="auth-controls">
        <Link href="/auth" className="auth-chip auth-chip-login">
          Logowanie
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="auth-controls">
        <button className="auth-chip auth-chip-login" type="button" onClick={() => setMenuOpen((s) => !s)}>
          Menu{pendingCount > 0 ? ` (${pendingCount})` : ""}
        </button>

        {menuOpen ? (
          <div className="auth-menu-popover">
            {auth.playerId ? (
              <Link className="auth-menu-item" href={`/players/${auth.playerId}`} onClick={() => setMenuOpen(false)}>
                1. Moj profil
              </Link>
            ) : (
              <span className="auth-menu-item auth-menu-item-disabled">1. Moj profil</span>
            )}
            <button className="auth-menu-item" type="button" onClick={() => void openNotificationsModal()}>
              2. Powiadomienia{pendingCount > 0 ? ` (${pendingCount})` : ""}
            </button>
            <button className="auth-menu-item" type="button" onClick={() => void openSettingsModal()}>
              3. Ustawienia
            </button>
            {auth.isMainAdmin ? (
              <Link className="auth-menu-item" href="/admin/tournaments" onClick={() => setMenuOpen(false)}>
                Main admin
              </Link>
            ) : null}
            {localAdminContext.isTournamentAdmin && localAdminContext.tournamentId ? (
              <Link
                className="auth-menu-item"
                href={`/tournaments/${localAdminContext.tournamentId}/admin`}
                onClick={() => setMenuOpen(false)}
              >
                Admin lokalny
              </Link>
            ) : null}
            <button className="auth-menu-item auth-menu-item-danger" type="button" onClick={logout}>
              4. Wyloguj
            </button>
          </div>
        ) : null}
      </div>

      {showNotifications ? (
        <div className="auth-modal-backdrop" onClick={() => setShowNotifications(false)}>
          <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
            <div className="auth-modal-head">
              <p className="auth-modal-title">Powiadomienia</p>
              <button className="auth-modal-close" onClick={() => setShowNotifications(false)} type="button">
                Zamknij
              </button>
            </div>

            <div className="auth-modal-tabs">
              <button
                type="button"
                className={`auth-modal-tab ${notificationsTab === "inbox" ? "active" : ""}`}
                onClick={() => setNotificationsTab("inbox")}
              >
                Odebrane
              </button>
              <button
                type="button"
                className={`auth-modal-tab ${notificationsTab === "sent" ? "active" : ""}`}
                onClick={() => setNotificationsTab("sent")}
              >
                Wyslane
              </button>
            </div>

            <div className="auth-modal-body">
              {notificationsTab === "inbox" ? (
                <>
                  <p className="auth-modal-subtitle">Zaproszenia do turniejow</p>
                  {(notifications?.incomingInvites ?? []).length === 0 ? (
                    <p className="tour-muted">Brak zaproszen.</p>
                  ) : (
                    <div className="auth-notif-list">
                      {(notifications?.incomingInvites ?? []).map((invite) => (
                        <div key={invite.id} className="auth-notif-row">
                          <div>
                            <p>
                              <strong>{invite.tournaments?.name ?? "Turniej"}</strong>
                            </p>
                            <p className="tour-muted">
                              od {invite.inviter?.name ?? "admina"} - {formatDateTime(invite.created_at)}
                            </p>
                            <p className="tour-muted">status: {invite.status}</p>
                          </div>
                          {invite.status === "pending" ? (
                            <div className="auth-notif-actions">
                              <button type="button" className="tour-action-btn" onClick={() => void handleInviteDecision(invite.id, "accept")}>
                                Przyjmij
                              </button>
                              <button type="button" className="tour-action-btn" onClick={() => void handleInviteDecision(invite.id, "reject")}>
                                Odrzuc
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="auth-modal-subtitle mt-3">Prosby graczy (jako lokalny admin)</p>
                  {(notifications?.adminJoinRequests ?? []).length === 0 ? (
                    <p className="tour-muted">Brak prosb do obslugi.</p>
                  ) : (
                    <div className="auth-notif-list">
                      {(notifications?.adminJoinRequests ?? []).map((req) => (
                        <div key={req.id} className="auth-notif-row">
                          <div>
                            <p>
                              <strong>{req.players?.name ?? "Zawodnik"}</strong> - {req.tournaments?.name ?? "Turniej"}
                            </p>
                            <p className="tour-muted">
                              {formatDateTime(req.created_at)} - status: {req.status}
                            </p>
                          </div>
                          {req.status === "pending" ? (
                            <div className="auth-notif-actions">
                              <button
                                type="button"
                                className="tour-action-btn"
                                onClick={() => void handleAdminRequestDecision(req.tournament_id, req.id, "accept")}
                              >
                                Akceptuj
                              </button>
                              <button
                                type="button"
                                className="tour-action-btn"
                                onClick={() => void handleAdminRequestDecision(req.tournament_id, req.id, "reject")}
                              >
                                Odrzuc
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="auth-modal-subtitle">Wyslane prosby o dolaczenie</p>
                  {(notifications?.sentJoinRequests ?? []).length === 0 ? (
                    <p className="tour-muted">Brak wyslanych prosb.</p>
                  ) : (
                    <div className="auth-notif-list">
                      {(notifications?.sentJoinRequests ?? []).map((req) => (
                        <div key={req.id} className="auth-notif-row">
                          <div>
                            <p>
                              <strong>{req.tournaments?.name ?? "Turniej"}</strong>
                            </p>
                            <p className="tour-muted">
                              {formatDateTime(req.created_at)} - status: {req.status}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="auth-modal-subtitle mt-3">Wyslane zaproszenia</p>
                  {(notifications?.sentInvites ?? []).length === 0 ? (
                    <p className="tour-muted">Brak wyslanych zaproszen.</p>
                  ) : (
                    <div className="auth-notif-list">
                      {(notifications?.sentInvites ?? []).map((invite) => (
                        <div key={invite.id} className="auth-notif-row">
                          <div>
                            <p>
                              <strong>{invite.players?.name ?? "Zawodnik"}</strong> - {invite.tournaments?.name ?? "Turniej"}
                            </p>
                            <p className="tour-muted">
                              {formatDateTime(invite.created_at)} - status: {invite.status}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {notifMsg ? <p className="tour-muted">{notifMsg}</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      {showSettings ? (
        <div className="auth-modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
            <div className="auth-modal-head">
              <p className="auth-modal-title">Ustawienia konta</p>
              <button className="auth-modal-close" onClick={() => setShowSettings(false)} type="button">
                Zamknij
              </button>
            </div>

            <div className="auth-modal-body">
              <label className="auth-settings-row">
                <input
                  type="checkbox"
                  checked={emailNotificationsEnabled}
                  onChange={(e) => void saveEmailNotificationsPreference(e.target.checked)}
                />
                <span>Powiadomienia o zaproszeniach na email</span>
              </label>

              <div className="auth-settings-box">
                <p className="auth-modal-subtitle">Zmien email</p>
                <input
                  className="auth-settings-input"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
                <button className="tour-action-btn" type="button" onClick={() => void changeEmail()}>
                  Zmien email
                </button>
              </div>

              <div className="auth-settings-box">
                <p className="auth-modal-subtitle">Zmien haslo</p>
                <input
                  className="auth-settings-input"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                />
                <button className="tour-action-btn" type="button" onClick={() => void changePassword()}>
                  Zmien haslo
                </button>
              </div>

              <div className="auth-settings-box">
                <p className="auth-modal-subtitle">Usun konto</p>
                <button className="tour-action-btn tour-action-danger" type="button" onClick={() => void deleteAccount()}>
                  Usuń konto
                </button>
              </div>

              {settingsMsg ? <p className="tour-muted">{settingsMsg}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
