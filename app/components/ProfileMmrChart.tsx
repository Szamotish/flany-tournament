"use client";

import { useEffect, useRef, useState } from "react";
import { clampChartWindow, filterProfileHistory, zoomChartWindow, type MmrChartPoint } from "@/lib/profileHistory";
import { PRESTIGE_POINTS_PER_MMR } from "@/lib/ranked";

const WIDTH = 300, HEIGHT = 112, PAD = 10;
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("pl-PL", { timeZone: "Europe/Warsaw" });

export default function ProfileMmrChart({ points, from, to, error = false }: {
  points: MmrChartPoint[]; from: string | null; to: string | null; error?: boolean;
}) {
  const filtered = filterProfileHistory(points, from, to);
  // Remount the interactive viewport after saving preferences or refreshing history.
  return <ChartViewport key={`${from}-${to}-${filtered.length}-${filtered[0]?.id}-${filtered.at(-1)?.id}`} points={filtered} error={error} />;
}

function ChartViewport({ points, error }: { points: MmrChartPoint[]; error: boolean }) {
  const fullSpan = Math.max(1, points.length - 1);
  const [view, setView] = useState({ start: 0, span: fullSpan });
  const [selected, setSelected] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ x: 0, distance: 0, moved: false });
  const visible = points.map((p, i) => ({ ...p, i })).filter(p => p.i >= Math.floor(view.start) && p.i <= Math.ceil(view.start + view.span));
  const values = visible.map(p => p.mmr + p.prestigePoints / PRESTIGE_POINTS_PER_MMR);
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 10;
  const padding = Math.max(0.3, (high - low) * 0.2);
  const min = Math.max(0, low - padding), max = Math.max(min + 1, high + padding);
  const x = (i: number) => PAD + ((i - view.start) / view.span) * (WIDTH - 2 * PAD);
  const y = (p: MmrChartPoint) => HEIGHT - PAD - ((p.mmr + p.prestigePoints / PRESTIGE_POINTS_PER_MMR - min) / (max - min)) * (HEIGHT - 2 * PAD);
  const line = visible.map(p => `${x(p.i)},${y(p)}`).join(" ");
  const detail = selected === null ? null : points[selected];

  useEffect(() => {
    const element = plot.current;
    if (!element || points.length < 3) return;
    function wheel(event: WheelEvent) {
      event.preventDefault();
      event.stopPropagation();
      const rect = element!.getBoundingClientRect();
      const anchor = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      setView(current => zoomChartWindow(current, points.length, Math.exp(Math.max(-0.7, Math.min(0.7, delta * 0.003))), anchor));
      setSelected(null);
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [points.length]);

  function pan(pixels: number) {
    const width = plot.current?.clientWidth ?? WIDTH;
    setView(current => clampChartWindow({ ...current, start: current.start - pixels / width * current.span }, points.length));
    setSelected(null);
  }
  function selectAt(clientX: number) {
    const rect = plot.current?.getBoundingClientRect();
    if (!rect) return;
    const fraction = ((clientX - rect.left) / rect.width * WIDTH - PAD) / (WIDTH - PAD * 2);
    setSelected(Math.max(0, Math.min(points.length - 1, Math.round(view.start + fraction * view.span))));
  }

  return <div className="profile-mmr-chart">
    <div className="profile-chart-heading">
      <p className="profile-muted">Historia MMR</p>
      {points.length > 2 ? <div className="profile-chart-controls">
        <button type="button" aria-label="Oddal wykres" disabled={view.span >= fullSpan} onClick={() => { setView(v => zoomChartWindow(v, points.length, 1.6)); setSelected(null); }}>−</button>
        <button type="button" aria-label="Przybliż wykres" disabled={view.span <= 2} onClick={() => { setView(v => zoomChartWindow(v, points.length, 1 / 1.6)); setSelected(null); }}>+</button>
        <button type="button" aria-label="Pokaż cały wybrany okres" disabled={view.span >= fullSpan} onClick={() => { setView({ start: 0, span: fullSpan }); setSelected(null); }}>Całość</button>
      </div> : null}
    </div>
    {error ? <p className="profile-muted">Nie udało się wczytać historii MMR.</p> : !points.length ? (
      <p className="profile-muted">Brak historii MMR w wybranym okresie.</p>
    ) : <>
      <div ref={plot} className="profile-chart-viewport" tabIndex={0} role="group"
        aria-label="Wykres MMR. Przybliż kółkiem myszy lub dwoma palcami. Przeciągnij, aby przesunąć. Klawiatura: plus, minus, strzałki i Home."
        onKeyDown={event => {
          if (["+", "=", "-", "Home", "ArrowLeft", "ArrowRight"].includes(event.key)) {
            event.preventDefault();
            if (event.key === "Home") { setView({ start: 0, span: fullSpan }); setSelected(null); }
            else if (event.key === "+" || event.key === "=") setView(v => zoomChartWindow(v, points.length, 1 / 1.6));
            else if (event.key === "-") setView(v => zoomChartWindow(v, points.length, 1.6));
            else {
              const index = Math.max(0, Math.min(points.length - 1, (selected ?? Math.round(view.start)) + (event.key === "ArrowRight" ? 1 : -1)));
              setSelected(index);
              setView(v => clampChartWindow({ ...v, start: index < v.start ? index : index > v.start + v.span ? index - v.span : v.start }, points.length));
            }
          }
        }}
        onPointerDown={event => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          const positions = [...pointers.current.values()];
          gesture.current = { x: event.clientX, distance: positions.length === 2 ? Math.hypot(positions[1].x - positions[0].x, positions[1].y - positions[0].y) : 0, moved: positions.length > 1 };
        }}
        onPointerMove={event => {
          if (!pointers.current.has(event.pointerId)) { if (event.pointerType === "mouse") selectAt(event.clientX); return; }
          const previous = pointers.current.get(event.pointerId)!;
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          const positions = [...pointers.current.values()];
          if (positions.length === 2) {
            const distance = Math.hypot(positions[1].x - positions[0].x, positions[1].y - positions[0].y);
            const rect = event.currentTarget.getBoundingClientRect();
            if (distance > 10 && gesture.current.distance > 10) {
              const anchor = Math.max(0, Math.min(1, ((positions[0].x + positions[1].x) / 2 - rect.left) / rect.width));
              const factor = gesture.current.distance / distance;
              setView(v => zoomChartWindow(v, points.length, factor, anchor));
            }
            gesture.current.distance = distance;
            gesture.current.moved = true;
            setSelected(null);
          } else if (positions.length === 1 && (gesture.current.moved || Math.abs(event.clientX - gesture.current.x) > 5)) {
            gesture.current.moved = true;
            pan(event.clientX - previous.x);
          }
        }}
        onPointerUp={event => {
          if (pointers.current.has(event.pointerId) && !gesture.current.moved) selectAt(event.clientX);
          pointers.current.delete(event.pointerId);
        }}
        onPointerCancel={event => pointers.current.delete(event.pointerId)}
        onLostPointerCapture={event => pointers.current.delete(event.pointerId)}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="profile-mmr-chart-svg" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => <line key={i} x1={PAD} x2={WIDTH - PAD} y1={PAD + i * (HEIGHT - 2 * PAD) / 4} y2={PAD + i * (HEIGHT - 2 * PAD) / 4} className="profile-mmr-chart-grid" />)}
          <polyline points={line} className="profile-mmr-chart-line" />
          {visible.map(p => <circle key={p.id} cx={x(p.i)} cy={y(p)} r={selected === p.i ? 4.5 : 2.5} className="profile-mmr-chart-dot" />)}
        </svg>
      </div>
      <div className="profile-chart-dates"><span>{dateLabel(points[Math.ceil(view.start)]?.playedAt ?? points[0].playedAt)}</span><span>{dateLabel(points[Math.floor(view.start + view.span)]?.playedAt ?? points.at(-1)!.playedAt)}</span></div>
      <p className="profile-chart-detail" aria-live="polite">{detail
        ? `${dateLabel(detail.playedAt)} · MMR ${detail.mmr.toFixed(1)} · PP ${detail.prestigePoints}${detail.tournamentName ? ` · ${detail.tournamentName}` : ""}`
        : "Dotknij punktu, aby zobaczyć wynik."}</p>
    </>}
  </div>;
}
