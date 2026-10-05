"use client";

import { useRef, useState } from "react";
import { useOracle } from "@/app/components/useOracle";
import { ORACLE_QUESTION_LENGTH, oracleStatusText } from "@/lib/oracleConfig";

const SHAKE_TARGET = 7;

export default function MagicOracle() {
  const oracle = useOracle();
  const { answer, busy: isShaking } = oracle;
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [, setShakeCount] = useState(0);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0, rotation: 0 });
  const lastXRef = useRef<number | null>(null);
  const lastYRef = useRef<number | null>(null);
  const directionRef = useRef<1 | -1 | 0>(0);

  function resetSession() {
    oracle.clearAnswer();
    setShakeCount(0);
    setDragOffset({ x: 0, y: 0, rotation: 0 });
    lastXRef.current = null;
    lastYRef.current = null;
    directionRef.current = 0;
  }

  function closeOracle() {
    setOpen(false);
    resetSession();
  }

  function revealAnswer() {
    const cleanQuestion = question.trim();
    if (!cleanQuestion) {
      return;
    }

    void oracle.ask(cleanQuestion);
  }

  function clearDrag() {
    lastXRef.current = null;
    lastYRef.current = null;
    directionRef.current = 0;
    setDragOffset({ x: 0, y: 0, rotation: 0 });
  }

  function registerMove(clientX: number, clientY: number) {
    if (answer || isShaking) return;
    if (!question.trim()) {
      return;
    }

    const lastX = lastXRef.current;
    const lastY = lastYRef.current;
    lastXRef.current = clientX;
    lastYRef.current = clientY;
    if (lastX === null || lastY === null) return;

    const diff = clientX - lastX;
    const diffY = clientY - lastY;
    if (Math.abs(diff) >= 2 || Math.abs(diffY) >= 2) {
      setDragOffset({
        x: Math.max(-34, Math.min(34, diff * 2.4)),
        y: Math.max(-18, Math.min(18, diffY * 1.8)),
        rotation: Math.max(-13, Math.min(13, diff * 0.42)),
      });
    }

    if (Math.abs(diff) < 10) return;

    const direction = diff > 0 ? 1 : -1;
    if (directionRef.current !== 0 && directionRef.current !== direction) {
      setShakeCount((current) => {
        const next = current + 1;
        if (next >= SHAKE_TARGET) {
          window.setTimeout(revealAnswer, 0);
          return SHAKE_TARGET;
        }
        return next;
      });
    }
    directionRef.current = direction;
  }

  return (
    <>
      {oracle.status?.available ? <article className="glass-card landing-oracle">
        <button className="oracle-card-button" type="button" onClick={() => setOpen(true)} aria-label="Otworz magiczna kule" />
      </article> : null}

      {open ? (
        <div className="oracle-overlay" role="dialog" aria-modal="true" aria-label="Magiczna kula">
          <button className="oracle-backdrop" type="button" aria-label="Zamknij" onClick={closeOracle} />
          <section className="oracle-modal">
            <button
              className={`oracle-ball ${isShaking ? "is-shaking" : ""} ${answer ? "has-answer" : ""}`}
              style={{
                transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0) rotate(${dragOffset.rotation}deg)`,
              }}
              type="button"
              onPointerDown={(event) => {
                lastXRef.current = event.clientX;
                lastYRef.current = event.clientY;
                directionRef.current = 0;
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => registerMove(event.clientX, event.clientY)}
              onPointerUp={clearDrag}
              onPointerCancel={clearDrag}
              aria-label="Potrzasnij kula"
            >
              <span className="oracle-ball-window">
                <span>{isShaking ? "…" : "?"}</span>
              </span>
            </button>

            <div className="oracle-form">
              {answer ? <p className="oracle-answer" aria-live="polite">{answer}</p> : null}
              {oracle.error ? <p role="alert">{oracle.error}</p> : null}
              {!oracle.status?.available && !isShaking ? <p role="status">{oracleStatusText(oracle.status)}</p> : null}
              <input
                id="oracle-question"
                className="tour-admin-input oracle-input"
                value={question}
                maxLength={ORACLE_QUESTION_LENGTH}
                disabled={isShaking || !oracle.status?.available}
                aria-label="Pytanie do kuli"
                onChange={(event) => {
                  setQuestion(event.target.value);
                  resetSession();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") revealAnswer();
                }}
                placeholder="Pytanie do kuli"
              />
              <button className="tour-action-btn" type="button" onClick={revealAnswer}
                disabled={isShaking || !oracle.status?.available || !question.trim()}>
                {isShaking ? "Kula odpowiada…" : "Zapytaj"}
              </button>
              <button className="tour-action-btn" type="button" onClick={closeOracle}>Zamknij</button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
