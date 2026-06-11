"use client";

import { useRef, useState } from "react";
import { answerOracle } from "@/lib/oracle";

type MagicOracleProps = {
  playerNames: string[];
  beerNames: string[];
  beerOfDay: string;
};

const SHAKE_TARGET = 7;
const MAX_QUESTION_LENGTH = 180;

export default function MagicOracle({ playerNames, beerNames, beerOfDay }: MagicOracleProps) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [, setShakeCount] = useState(0);
  const [isShaking, setIsShaking] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0, rotation: 0 });
  const lastXRef = useRef<number | null>(null);
  const lastYRef = useRef<number | null>(null);
  const directionRef = useRef<1 | -1 | 0>(0);

  function resetSession() {
    setAnswer(null);
    setShakeCount(0);
    setIsShaking(false);
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

    setIsShaking(true);
    window.setTimeout(() => {
      setAnswer(answerOracle(cleanQuestion, { playerNames, beerNames, beerOfDay }));
      setIsShaking(false);
    }, 620);
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
      <article className="glass-card landing-oracle">
        <button className="oracle-card-button" type="button" onClick={() => setOpen(true)} aria-label="Otworz magiczna kule" />
      </article>

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
                {answer ? <span>{answer}</span> : <span>?</span>}
              </span>
            </button>

            <div className="oracle-form">
              <input
                id="oracle-question"
                className="tour-admin-input oracle-input"
                value={question}
                maxLength={MAX_QUESTION_LENGTH}
                onChange={(event) => {
                  setQuestion(event.target.value);
                  resetSession();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") revealAnswer();
                }}
                placeholder="Pytanie do kuli"
              />
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
