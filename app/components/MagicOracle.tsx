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
  const lastXRef = useRef<number | null>(null);
  const directionRef = useRef<1 | -1 | 0>(0);

  function resetSession() {
    setAnswer(null);
    setShakeCount(0);
    setIsShaking(false);
    lastXRef.current = null;
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

  function registerMove(clientX: number) {
    if (answer || isShaking) return;
    if (!question.trim()) {
      return;
    }

    const lastX = lastXRef.current;
    lastXRef.current = clientX;
    if (lastX === null) return;

    const diff = clientX - lastX;
    if (Math.abs(diff) < 12) return;

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
              type="button"
              onPointerDown={(event) => {
                lastXRef.current = event.clientX;
                directionRef.current = 0;
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => registerMove(event.clientX)}
              onPointerUp={() => {
                lastXRef.current = null;
                directionRef.current = 0;
              }}
              onPointerCancel={() => {
                lastXRef.current = null;
                directionRef.current = 0;
              }}
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
