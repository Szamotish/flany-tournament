"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

type BackgroundVariant = "finn_bmo" | "finn_beer";

export default function GlobalFinnBackground() {
  const [background, setBackground] = useState<BackgroundVariant>("finn_bmo");

  useEffect(() => {
    const root = document.documentElement;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let raf = 0;

    const render = () => {
      currentX += (targetX - currentX) * 0.24;
      currentY += (targetY - currentY) * 0.24;

      root.style.setProperty("--finn-look-x", currentX.toFixed(4));
      root.style.setProperty("--finn-look-y", currentY.toFixed(4));

      if (
        Math.abs(targetX - currentX) > 0.0005 ||
        Math.abs(targetY - currentY) > 0.0005
      ) {
        raf = window.requestAnimationFrame(render);
      } else {
        raf = 0;
      }
    };

    const schedule = () => {
      if (!raf) {
        raf = window.requestAnimationFrame(render);
      }
    };

    const updateTarget = (clientX: number, clientY: number) => {
      const w = Math.max(window.innerWidth, 1);
      const h = Math.max(window.innerHeight, 1);
      targetX = clamp((clientX / w - 0.5) * 2, -1, 1);
      targetY = clamp((clientY / h - 0.5) * 2, -1, 1);
      schedule();
    };

    const handlePointerMove = (event: PointerEvent) => {
      updateTarget(event.clientX, event.clientY);
    };

    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      updateTarget(touch.clientX, touch.clientY);
    };

    const handleLeave = () => {
      targetX = 0;
      targetY = 0;
      schedule();
    };

    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("pointerleave", handleLeave);
    window.addEventListener("blur", handleLeave);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("pointerleave", handleLeave);
      window.removeEventListener("blur", handleLeave);
      if (raf) {
        window.cancelAnimationFrame(raf);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadBackground() {
      const res = await fetch("/api/public/background", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { background?: unknown };
      if (cancelled) return;

      if (res.ok && (json.background === "finn_bmo" || json.background === "finn_beer")) {
        setBackground(json.background);
      }
    }

    void loadBackground();

    return () => {
      cancelled = true;
    };
  }, []);

  const src = background === "finn_beer" ? "/finn-piwo.png" : "/peakpx.jpg";

  return (
    <div className={`finn-bg ${background === "finn_beer" ? "is-beer" : "is-bmo"}`} aria-hidden>
      <div className={`finn-bg-art ${background === "finn_beer" ? "is-beer" : "is-bmo"}`}>
        <Image
          src={src}
          alt=""
          fill
          priority
          sizes="100vw"
          className="finn-bg-image"
        />
        {background === "finn_beer" ? (
          <>
            <span className="finn-eye finn-eye-beer-left">
              <span className="finn-eye-pupil finn-eye-pupil-beer" />
            </span>
            <span className="finn-eye finn-eye-beer-right">
              <span className="finn-eye-pupil finn-eye-pupil-beer" />
            </span>
          </>
        ) : (
          <>
            <span className="finn-eye finn-eye-bmo-left">
              <span className="finn-eye-pupil finn-eye-pupil-bmo" />
            </span>
            <span className="finn-eye finn-eye-bmo-right">
              <span className="finn-eye-pupil finn-eye-pupil-bmo" />
            </span>
          </>
        )}
      </div>
    </div>
  );
}
