"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/authClient";

type MembershipState = {
  authenticated: boolean;
  inTournament: boolean;
  pendingRequest: boolean;
  pendingInvite: boolean;
  tournamentStarted: boolean;
};

type Props = {
  tournamentId: string;
};

async function readMembership(tournamentId: string): Promise<MembershipState> {
  const res = await authedFetch(`/api/public/tournaments/${tournamentId}/membership`, {
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  return {
    authenticated: json.authenticated === true,
    inTournament: json.inTournament === true,
    pendingRequest: json.pendingRequest === true,
    pendingInvite: json.pendingInvite === true,
    tournamentStarted: json.tournamentStarted === true,
  };
}

export default function TournamentJoinActions({ tournamentId }: Props) {
  const [state, setState] = useState<MembershipState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const next = await readMembership(tournamentId);
    setState(next);
  }, [tournamentId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = await readMembership(tournamentId);
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [tournamentId]);

  async function requestJoin() {
    setBusy(true);
    setMsg(null);
    const res = await authedFetch(`/api/public/tournaments/${tournamentId}/join-request`, {
      method: "POST",
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      if (json.error === "join_deadline_passed") setMsg("Minal deadline prosb o dolaczenie.");
      else if (json.error === "request_already_pending") setMsg("Masz juz aktywna prosbe.");
      else setMsg(`Blad: ${json.error ?? res.statusText}`);
      return;
    }
    setMsg("Prosba wyslana do lokalnych adminow.");
    await reload();
  }

  async function cancelRequest() {
    setBusy(true);
    setMsg(null);
    const res = await authedFetch(`/api/public/tournaments/${tournamentId}/join-request`, {
      method: "DELETE",
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(`Blad: ${json.error ?? res.statusText}`);
      return;
    }
    setMsg("Prosba anulowana.");
    await reload();
  }

  async function leaveTournament() {
    setBusy(true);
    setMsg(null);
    const res = await authedFetch(`/api/public/tournaments/${tournamentId}/leave`, {
      method: "POST",
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(`Blad: ${json.error ?? res.statusText}`);
      return;
    }
    setMsg("Opusciles turniej.");
    await reload();
  }

  if (!state) {
    return <p className="tour-muted mt-3">Ladowanie statusu uczestnictwa...</p>;
  }

  if (!state.authenticated) {
    return (
      <p className="tour-muted mt-3">
        <Link className="underline" href={`/auth?next=/tournaments/${tournamentId}`}>
          Zaloguj sie
        </Link>{" "}
        aby dolaczac do turnieju.
      </p>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {state.tournamentStarted ? (
        <button className="tour-action-btn" type="button" disabled>
          Turniej rozpoczety
        </button>
      ) : state.inTournament ? (
        <button className="tour-action-btn" type="button" onClick={leaveTournament} disabled={busy}>
          Opusc turniej
        </button>
      ) : state.pendingRequest ? (
        <button className="tour-action-btn" type="button" onClick={cancelRequest} disabled={busy}>
          Anuluj prosbe
        </button>
      ) : (
        <button className="tour-action-btn" type="button" onClick={requestJoin} disabled={busy}>
          Popros o dolaczenie
        </button>
      )}

      {state.pendingInvite ? (
        <span className="tour-muted">Masz zaproszenie. Otworz Menu - Powiadomienia.</span>
      ) : null}

      {msg ? <p className="tour-muted">{msg}</p> : null}
    </div>
  );
}
