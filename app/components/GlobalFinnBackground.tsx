"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

type BackgroundVariant = "finn_bmo" | "finn_beer";

type BeerEyeLayout = {
  leftX: number;
  rightX: number;
  topY: number;
  eyeWidth: number;
  eyeHeight: number;
  pupilSize: number;
  objectPosition: string;
};

const BEER_IMAGE_WIDTH = 1536;
const BEER_IMAGE_HEIGHT = 1024;
const BEER_EYE_LEFT_X = 0.7115;
const BEER_EYE_RIGHT_X = 0.7505;
const BEER_EYE_TOP_Y = 0.3875;
const BEER_EYE_WIDTH_RATIO = 24 / BEER_IMAGE_WIDTH;
const BEER_EYE_HEIGHT_RATIO = 25 / BEER_IMAGE_HEIGHT;
const BEER_PUPIL_RATIO = 0.46;

function beerImagePositionX(viewportWidth: number): number {
  if (viewportWidth <= 420) return 0.88;
  if (viewportWidth <= 600) return 0.84;
  if (viewportWidth <= 820) return 0.8;
  if (viewportWidth <= 1200) return 0.7;
  return 0.56;
}

function computeBeerEyeLayout(viewportWidth: number, viewportHeight: number): BeerEyeLayout {
  const safeW = Math.max(viewportWidth, 1);
  const safeH = Math.max(viewportHeight, 1);

  const scale = Math.max(safeW / BEER_IMAGE_WIDTH, safeH / BEER_IMAGE_HEIGHT);
  const renderWidth = BEER_IMAGE_WIDTH * scale;
  const renderHeight = BEER_IMAGE_HEIGHT * scale;

  const objectPosX = beerImagePositionX(safeW);
  const objectPosY = 0.5;

  const offsetX = (safeW - renderWidth) * objectPosX;
  const offsetY = (safeH - renderHeight) * objectPosY;

  const eyeWidth = clamp(renderWidth * BEER_EYE_WIDTH_RATIO, 18, 36);
  const eyeHeight = clamp(renderHeight * BEER_EYE_HEIGHT_RATIO, 19, 38);
  const pupilSize = clamp(eyeWidth * BEER_PUPIL_RATIO, 9, 17);

  return {
    leftX: offsetX + BEER_EYE_LEFT_X * renderWidth,
    rightX: offsetX + BEER_EYE_RIGHT_X * renderWidth,
    topY: offsetY + BEER_EYE_TOP_Y * renderHeight,
    eyeWidth,
    eyeHeight,
    pupilSize,
    objectPosition: `${(objectPosX * 100).toFixed(2)}% ${(objectPosY * 100).toFixed(2)}%`,
  };
}

export default function GlobalFinnBackground() {
  const [background, setBackground] = useState<BackgroundVariant>("finn_bmo");
  const [beerEyeLayout, setBeerEyeLayout] = useState<BeerEyeLayout | null>(null);

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

  useEffect(() => {
    if (background !== "finn_beer") return;

    const updateLayout = () => {
      setBeerEyeLayout(computeBeerEyeLayout(window.innerWidth, window.innerHeight));
    };

    updateLayout();
    window.addEventListener("resize", updateLayout);
    window.addEventListener("orientationchange", updateLayout);

    return () => {
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("orientationchange", updateLayout);
    };
  }, [background]);

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
          style={background === "finn_beer" && beerEyeLayout ? { objectPosition: beerEyeLayout.objectPosition } : undefined}
        />
        {background === "finn_beer" ? (
          <>
            <span
              className="finn-eye finn-eye-beer-left"
              style={
                beerEyeLayout
                  ? {
                      left: `${beerEyeLayout.leftX}px`,
                      top: `${beerEyeLayout.topY}px`,
                      width: `${beerEyeLayout.eyeWidth}px`,
                      height: `${beerEyeLayout.eyeHeight}px`,
                    }
                  : { opacity: 0 }
              }
            >
              <span
                className="finn-eye-pupil finn-eye-pupil-beer"
                style={
                  beerEyeLayout
                    ? {
                        width: `${beerEyeLayout.pupilSize}px`,
                        height: `${beerEyeLayout.pupilSize}px`,
                      }
                    : undefined
                }
              />
            </span>
            <span
              className="finn-eye finn-eye-beer-right"
              style={
                beerEyeLayout
                  ? {
                      left: `${beerEyeLayout.rightX}px`,
                      top: `${beerEyeLayout.topY}px`,
                      width: `${beerEyeLayout.eyeWidth}px`,
                      height: `${beerEyeLayout.eyeHeight}px`,
                    }
                  : { opacity: 0 }
              }
            >
              <span
                className="finn-eye-pupil finn-eye-pupil-beer"
                style={
                  beerEyeLayout
                    ? {
                        width: `${beerEyeLayout.pupilSize}px`,
                        height: `${beerEyeLayout.pupilSize}px`,
                      }
                    : undefined
                }
              />
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
