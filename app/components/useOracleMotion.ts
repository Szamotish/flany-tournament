"use client";

import { useEffect, useEffectEvent, useState } from "react";

type MotionAccess = "unsupported" | "prompt" | "pending" | "enabled" | "denied";
type MotionAPI = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

export function useOracleMotion(armed: boolean, question: string, onShake: () => void) {
  const [access, setAccess] = useState<MotionAccess>("unsupported");
  const shake = useEffectEvent(onShake);

  // Called by opening the ball, never during server rendering. iOS permission
  // is requested separately, directly from an explicit button click.
  function detect() {
    if (!window.isSecureContext || typeof window.DeviceMotionEvent === "undefined"
      || !(navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches)) return;
    const api = window.DeviceMotionEvent as MotionAPI;
    setAccess(current => current === "enabled" || current === "denied" || current === "pending"
      ? current : api.requestPermission ? "prompt" : "enabled");
  }

  async function enable() {
    const api = window.DeviceMotionEvent as MotionAPI;
    setAccess("pending");
    try {
      const result = api.requestPermission ? await api.requestPermission() : "granted";
      setAccess(result === "granted" ? "enabled" : "denied");
    } catch {
      setAccess("denied");
    }
  }

  useEffect(() => {
    if (!armed || access !== "enabled") return;
    let lastSample = performance.now();
    let readyAt = lastSample + 400;
    let gravity: [number, number] | null = null;
    let axis = 0, direction = 0, reversals = 0, lastImpulse = 0;
    let fired = false;

    function reset() {
      gravity = null;
      direction = 0;
      reversals = 0;
      lastImpulse = 0;
      readyAt = performance.now() + 400;
    }

    function move(event: DeviceMotionEvent) {
      if (fired || document.visibilityState !== "visible") return;
      const now = performance.now();
      const dt = Math.max(1, now - lastSample);
      lastSample = now;
      const linear = event.acceleration;
      const raw = event.accelerationIncludingGravity;
      const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);
      let values: [number, number];
      if (finite(linear?.x) && finite(linear?.y)) {
        values = [linear.x, linear.y];
      } else if (finite(raw?.x) && finite(raw?.y)) {
        // Remove gravity where the browser only exposes combined acceleration.
        if (!gravity || dt > 500) { gravity = [raw.x, raw.y]; return; }
        const alpha = dt / (180 + dt);
        gravity = [gravity[0] + alpha * (raw.x - gravity[0]), gravity[1] + alpha * (raw.y - gravity[1])];
        values = [raw.x - gravity[0], raw.y - gravity[1]];
      } else return;
      if (now < readyAt) return;
      if (now - lastImpulse > 800) { direction = 0; reversals = 0; }
      // Device X in portrait or Y in landscape: lock to one axis per gesture.
      if (!direction) axis = Math.abs(values[0]) >= Math.abs(values[1]) ? 0 : 1;
      const value = values[axis];
      if (Math.abs(value) < 5 || now - lastImpulse < 90) return;
      const next = Math.sign(value);
      if (next === direction) return;
      if (direction) reversals++;
      direction = next;
      lastImpulse = now;
      if (reversals >= 4) {
        fired = true; // One request even if more motion events arrive before React renders.
        shake();
      }
    }

    window.addEventListener("devicemotion", move);
    document.addEventListener("visibilitychange", reset);
    return () => {
      window.removeEventListener("devicemotion", move);
      document.removeEventListener("visibilitychange", reset);
    };
  }, [armed, access, question]);

  return { access, detect, enable };
}
