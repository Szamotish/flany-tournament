"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type StoreInfo = {
  name: string;
  lat: number;
  lon: number;
  kind: "alcohol" | "beverages" | "convenience";
  distanceKm: number;
  address?: string;
};

type CompassState = "idle" | "loading" | "ready" | "error";
type OrientationPermissionState = "checking" | "prompt" | "granted" | "denied" | "unsupported";

type OrientationEventIOS = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
};

type DeviceOrientationWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

function normalizeDeg(value: number): number {
  let v = value % 360;
  if (v < 0) v += 360;
  return v;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const earthKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthKm * c;
}

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a1 = toRadians(lat1);
  const a2 = toRadians(lat2);
  const dLon = toRadians(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(a2);
  const x = Math.cos(a1) * Math.sin(a2) - Math.sin(a1) * Math.cos(a2) * Math.cos(dLon);
  return normalizeDeg((Math.atan2(y, x) * 180) / Math.PI);
}

function directionLabel(bearing: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(bearing / 45) % 8];
}

function kindLabel(kind: StoreInfo["kind"]): string {
  if (kind === "alcohol") return "Sklep alkoholowy";
  if (kind === "beverages") return "Sklep z napojami";
  return "Sklep";
}

function getScreenAngle(): number {
  if (typeof screen !== "undefined" && typeof screen.orientation?.angle === "number") {
    return screen.orientation.angle;
  }

  const legacyOrientation = (window as Window & { orientation?: number }).orientation;
  if (typeof legacyOrientation === "number") {
    return legacyOrientation;
  }

  return 0;
}

function extractHeading(event: OrientationEventIOS): number | null {
  if (typeof event.webkitCompassHeading === "number" && Number.isFinite(event.webkitCompassHeading)) {
    return normalizeDeg(event.webkitCompassHeading);
  }

  if (typeof event.alpha !== "number" || !Number.isFinite(event.alpha)) {
    return null;
  }

  return normalizeDeg(360 - event.alpha + getScreenAngle());
}

export default function NearbyLiquorCompassCard() {
  const [state, setState] = useState<CompassState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [orientationPermission, setOrientationPermission] = useState<OrientationPermissionState>(() => {
    if (typeof window === "undefined" || typeof DeviceOrientationEvent === "undefined") {
      return "unsupported";
    }

    const ctor = DeviceOrientationEvent as DeviceOrientationWithPermission;
    return typeof ctor.requestPermission === "function" ? "prompt" : "granted";
  });
  const [smoothArrowRotation, setSmoothArrowRotation] = useState(0);
  const [orientationEnabled, setOrientationEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof DeviceOrientationEvent === "undefined") {
      return false;
    }

    const ctor = DeviceOrientationEvent as DeviceOrientationWithPermission;
    return typeof ctor.requestPermission !== "function";
  });
  const lastFetchRef = useRef<{ lat: number; lon: number; ts: number } | null>(null);
  const lastGoodStoreRef = useRef<StoreInfo | null>(null);
  const desiredRotationRef = useRef(0);
  const currentRotationRef = useRef(0);
  const rotationVelocityRef = useRef(0);

  const requestOrientationPermission = useCallback(async () => {
    if (typeof DeviceOrientationEvent === "undefined") {
      setOrientationPermission("unsupported");
      return;
    }

    const ctor = DeviceOrientationEvent as DeviceOrientationWithPermission;

    if (typeof ctor.requestPermission !== "function") {
      setOrientationPermission("granted");
      setOrientationEnabled(true);
      return;
    }

    try {
      const result = await ctor.requestPermission();
      if (result === "granted") {
        setOrientationPermission("granted");
        setOrientationEnabled(true);
      } else {
        setOrientationPermission("denied");
      }
    } catch {
      setOrientationPermission("denied");
    }
  }, []);

  useEffect(() => {
    if (orientationPermission !== "prompt") return;

    const activateOnFirstGesture = () => {
      void requestOrientationPermission();
    };

    window.addEventListener("pointerdown", activateOnFirstGesture, { once: true, passive: true });
    window.addEventListener("keydown", activateOnFirstGesture, { once: true });

    return () => {
      window.removeEventListener("pointerdown", activateOnFirstGesture);
      window.removeEventListener("keydown", activateOnFirstGesture);
    };
  }, [orientationPermission, requestOrientationPermission]);

  useEffect(() => {
    if (!orientationEnabled) return;

    const onOrientation = (event: Event) => {
      const resolvedHeading = extractHeading(event as OrientationEventIOS);
      if (resolvedHeading === null) return;
      setHeading(resolvedHeading);
    };

    window.addEventListener("deviceorientation", onOrientation, true);
    window.addEventListener("deviceorientationabsolute", onOrientation, true);

    return () => {
      window.removeEventListener("deviceorientation", onOrientation, true);
      window.removeEventListener("deviceorientationabsolute", onOrientation, true);
    };
  }, [orientationEnabled]);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      const timer = window.setTimeout(() => {
        setState("error");
        setError("Ta przegladarka nie obsluguje lokalizacji.");
      }, 0);
      return () => window.clearTimeout(timer);
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        setCoords({ lat, lon });
      },
      (geoError) => {
        setState("error");
        if (geoError.code === geoError.PERMISSION_DENIED) {
          setError("Brak zgody na lokalizacje.");
          return;
        }
        setError("Nie udalo sie pobrac lokalizacji.");
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 15000,
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    if (!coords) return;
    const currentCoords = coords;

    const now = Date.now();
    const last = lastFetchRef.current;
    if (last) {
      const movedKm = haversineKm(last.lat, last.lon, currentCoords.lat, currentCoords.lon);
      const elapsedMs = now - last.ts;
      if (movedKm < 0.12 && elapsedMs < 25000) return;
    }

    let cancelled = false;

    async function loadNearestStore() {
      try {
        const res = await fetch(
          `/api/public/nearest-liquor?lat=${currentCoords.lat}&lon=${currentCoords.lon}&radius_m=12000`,
          { cache: "no-store" }
        );
        const json = (await res.json().catch(() => ({}))) as {
          store?: StoreInfo | null;
          error?: string;
        };

        if (cancelled) return;

        lastFetchRef.current = { lat: currentCoords.lat, lon: currentCoords.lon, ts: Date.now() };

        if (!res.ok) {
          if (lastGoodStoreRef.current) {
            setStore(lastGoodStoreRef.current);
            setState("ready");
            setError(null);
            return;
          }
          setState("error");
          setError(`Blad wyszukiwania sklepu (${json.error ?? res.statusText}).`);
          return;
        }

        if (!json.store) {
          setState("error");
          setStore(null);
          lastGoodStoreRef.current = null;
          setError("Nie znaleziono sklepu w poblizu (do 12 km).");
          return;
        }

        setStore(json.store);
        lastGoodStoreRef.current = json.store;
        setState("ready");
        setError(null);
      } catch {
        if (cancelled) return;
        if (lastGoodStoreRef.current) {
          setStore(lastGoodStoreRef.current);
          setState("ready");
          setError(null);
          return;
        }
        setState("error");
        setError("Nie udalo sie pobrac danych o sklepie.");
      }
    }

    void loadNearestStore();

    return () => {
      cancelled = true;
    };
  }, [coords]);

  const targetBearing = useMemo(() => {
    if (!coords || !store) return null;
    return bearingDeg(coords.lat, coords.lon, store.lat, store.lon);
  }, [coords, store]);

  const arrowRotation = useMemo(() => {
    if (targetBearing === null) return 0;
    const base = heading ?? 0;
    return normalizeDeg(targetBearing - base);
  }, [heading, targetBearing]);

  useEffect(() => {
    desiredRotationRef.current = arrowRotation;
  }, [arrowRotation]);

  useEffect(() => {
    let raf = 0;

    const animate = () => {
      const current = currentRotationRef.current;
      const target = desiredRotationRef.current;
      let delta = target - current;
      delta = ((delta + 540) % 360) - 180;

      rotationVelocityRef.current += delta * 0.11;
      rotationVelocityRef.current *= 0.79;

      const next = normalizeDeg(current + rotationVelocityRef.current);
      currentRotationRef.current = next;
      setSmoothArrowRotation(next);

      raf = window.requestAnimationFrame(animate);
    };

    raf = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  return (
    <article className="glass-card landing-compass">
      <div className="card-head">
        <h2>Kompas Alkoholowy</h2>
        {store && targetBearing !== null ? <p>{directionLabel(targetBearing)}</p> : null}
      </div>

      <div className="compass-wrap">
        <div className="compass-rose" aria-hidden>
          <svg className="mc-compass" viewBox="0 0 24 24" role="presentation" shapeRendering="crispEdges">
            <path d="M8 2h8v1h2v2h1v10h-1v2h-2v1H8v-1H6v-2H5V5h1V3h2z" fill="#1d1713" />
            <path d="M8 3h8v1h1v1h1v10h-1v1h-1v1H8v-1H7v-1H6V5h1V4h1z" fill="#9ca2ac" />
            <path d="M7 16h10v2H7z" fill="#d8dce2" />
            <path d="M8 18h8v1H8z" fill="#959ba4" />
            <path d="M8 5h8v1H8z" fill="#c6cbd2" />
            <path d="M8 6h8v1H8z" fill="#252a31" />
            <path d="M7 7h10v7H7z" fill="#2b3038" />
            <path d="M8 8h8v1H8z" fill="#515862" />
            <path d="M9 9h7v1H9z" fill="#5f6670" />
            <path d="M8 10h5v1H8z" fill="#474d58" />
            <path d="M8 13h8v1H8z" fill="#1f242b" />
            <path d="M6 18h1v1H6zM17 18h1v1h-1zM5 17h1v1H5zM18 17h1v1h-1z" fill="#1b130b" />
            <g className="mc-compass-needle" transform={`rotate(${smoothArrowRotation} 12 12)`}>
              <path d="M12 5h1v1h1v1h1v1h-1v1h-1v1h-1z" fill="#ff2d2d" />
              <path d="M12 6h1v1h1v1h-1v1h-1z" fill="#ff7676" />
              <path d="M11 10h3v4h-3z" fill="#d11b24" />
              <path d="M12 10h1v4h-1z" fill="#ff4f57" />
              <path d="M11 13h3v5h-3z" fill="#7a808a" />
              <path d="M12 13h1v5h-1z" fill="#a3aab5" />
              <rect x="11" y="11" width="2" height="2" fill="#d1d6dd" />
              <rect x="11" y="11" width="1" height="1" fill="#f4f6f8" />
            </g>
          </svg>
        </div>

        <div className="compass-meta">
          {state === "ready" && store ? <p className="weather-label">{store.name}</p> : null}
          {state === "ready" && store ? (
            <p className="weather-sub">
              {kindLabel(store.kind)} - {store.distanceKm.toFixed(2)} km
            </p>
          ) : null}
          {orientationPermission === "prompt" ? <p className="weather-sub">Dotknij ekranu, aby aktywowac kompas.</p> : null}
          {orientationPermission === "denied" ? (
            <p className="weather-sub">Brak dostepu do czujnika orientacji telefonu.</p>
          ) : null}
          {orientationPermission === "granted" && heading === null ? (
            <p className="weather-sub">Obroc telefonem, aby skalibrowac kompas.</p>
          ) : null}
          {error ? <p className="weather-sub">{error}</p> : null}
          {state === "loading" ? <p className="weather-sub">Ustalanie lokalizacji...</p> : null}
        </div>
      </div>

      <a
        className="tour-action-btn compass-nav-btn"
        href={store ? `https://www.google.com/maps/dir/?api=1&destination=${store.lat},${store.lon}` : "#"}
        target={store ? "_blank" : undefined}
        rel={store ? "noreferrer" : undefined}
        aria-disabled={!store}
        onClick={(e) => {
          if (!store) e.preventDefault();
        }}
      >
        Nawiguj
      </a>
    </article>
  );
}
