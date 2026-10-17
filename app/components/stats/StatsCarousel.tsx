"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./Stats.module.css";

export default function StatsCarousel({ children, labels, initial = 0, auto = false, className = "", title }: {
  children: ReactNode[]; labels: string[]; initial?: number; auto?: boolean; className?: string; title: string;
}) {
  const [index, setIndex] = useState(Math.max(0, Math.min(initial, children.length - 1)));
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const move = (delta: number) => setIndex(i => (i + delta + children.length) % children.length);
  useEffect(() => {
    if (!auto || paused || hovered || focused || children.length < 2 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => { if (!document.hidden) setIndex(i => (i + 1) % children.length); }, 8000);
    return () => clearInterval(timer);
  }, [auto, paused, hovered, focused, children.length]);
  const active = Math.min(index, children.length - 1);
  return <section className={`${className} ${styles.carousel}`} aria-label={title} aria-roledescription="karuzela"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}
    onTouchStart={e => { if (e.touches.length === 1) touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
    onTouchEnd={e => {
      const start = touch.current; touch.current = null;
      if (!start || !e.changedTouches.length) return;
      const dx = e.changedTouches[0].clientX - start.x, dy = e.changedTouches[0].clientY - start.y;
      if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) { move(dx < 0 ? 1 : -1); setPaused(true); }
    }}>
    <div className={styles.controls}>
      <button type="button" aria-label="Poprzedni panel" onClick={() => { move(-1); setPaused(true); }}>←</button>
      <span>{labels[active]} <small>{active + 1}/{children.length}</small></span>
      <button type="button" aria-label="Następny panel" onClick={() => { move(1); setPaused(true); }}>→</button>
      {auto && children.length > 1 && <button type="button" onClick={() => setPaused(p => !p)} aria-label={paused ? "Włącz zmianę paneli" : "Wstrzymaj zmianę paneli"}>{paused ? "Wznów" : "Pauza"}</button>}
    </div>
    <div className={styles.slide} aria-live={auto && !paused ? "off" : "polite"} aria-atomic="true">{children[active]}</div>
    <div className={styles.dots}>{labels.map((label, i) => <button key={i} type="button" aria-label={`Pokaż: ${label}`} aria-current={active === i ? "true" : undefined}
      onClick={() => { setIndex(i); setPaused(true); }}><span /></button>)}</div>
  </section>;
}
