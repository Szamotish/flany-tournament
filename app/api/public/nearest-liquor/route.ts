import { NextResponse } from "next/server";

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

type Candidate = {
  name: string;
  lat: number;
  lon: number;
  kind: "alcohol" | "beverages" | "convenience";
  distanceKm: number;
  address?: string;
};

type StorePayload = {
  store: (Candidate & { distanceKm: number }) | null;
  radiusM: number;
};

type CacheEntry = {
  ts: number;
  payload: StorePayload;
};

const SHOP_FILTER = "alcohol|beverages|convenience|supermarket|grocery|greengrocer|mini_market";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
] as const;
const OVERPASS_TIMEOUT_MS = 8000;
const OVERPASS_ATTEMPTS_PER_ENDPOINT = 2;
const CACHE_TTL_MS = 45_000;
const STALE_CACHE_TTL_MS = 5 * 60_000;
const inMemoryCache = new Map<string, CacheEntry>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseNum(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
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

function buildAddress(tags: Record<string, string> | undefined): string | undefined {
  if (!tags) return undefined;
  const parts: string[] = [];
  const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
  if (street) parts.push(street);
  if (tags["addr:city"]) parts.push(tags["addr:city"]);
  if (parts.length === 0) return undefined;
  return parts.join(", ");
}

function classifyShop(tags: Record<string, string> | undefined): Candidate["kind"] | null {
  const shop = tags?.shop;
  if (!shop) return null;
  if (shop === "alcohol") return "alcohol";
  if (shop === "beverages") return "beverages";
  if (
    shop === "convenience" ||
    shop === "supermarket" ||
    shop === "grocery" ||
    shop === "greengrocer" ||
    shop === "mini_market"
  ) {
    return "convenience";
  }
  return null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function cacheKey(lat: number, lon: number, radiusM: number): string {
  return `${round(lat, 3)}:${round(lon, 3)}:${radiusM}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildSearchRadii(maxRadiusM: number): number[] {
  const steps = [3000, 7000, maxRadiusM]
    .map((r) => Math.min(r, maxRadiusM))
    .filter((r) => r >= 1000);
  return [...new Set(steps)].sort((a, b) => a - b);
}

function buildOverpassQuery(lat: number, lon: number, radiusM: number): string {
  return `
[out:json][timeout:12];
(
  node(around:${radiusM},${lat},${lon})["shop"~"${SHOP_FILTER}"];
  way(around:${radiusM},${lat},${lon})["shop"~"${SHOP_FILTER}"];
  relation(around:${radiusM},${lat},${lon})["shop"~"${SHOP_FILTER}"];
);
out center tags qt;
`;
}

async function fetchOverpass(query: string): Promise<{ elements?: OverpassElement[] }> {
  let lastError: unknown = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < OVERPASS_ATTEMPTS_PER_ENDPOINT; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
          body: new URLSearchParams({ data: query }),
          cache: "no-store",
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`overpass_status_${res.status}`);
        }

        return (await res.json()) as { elements?: OverpassElement[] };
      } catch (error) {
        lastError = error;
        await sleep(180 * (attempt + 1));
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  throw lastError ?? new Error("overpass_failed");
}

function mapElementsToCandidates(elements: OverpassElement[], safeLat: number, safeLon: number): Candidate[] {
  const candidates: Candidate[] = [];

  for (const el of elements) {
    const kind = classifyShop(el.tags);
    if (!kind) continue;

    const latVal = typeof el.lat === "number" ? el.lat : el.center?.lat;
    const lonVal = typeof el.lon === "number" ? el.lon : el.center?.lon;
    if (typeof latVal !== "number" || typeof lonVal !== "number") continue;

    const distanceKm = haversineKm(safeLat, safeLon, latVal, lonVal);
    const name =
      el.tags?.name ??
      (kind === "alcohol" ? "Sklep alkoholowy" : kind === "beverages" ? "Sklep z napojami" : "Sklep");

    candidates.push({
      name,
      lat: latVal,
      lon: lonVal,
      kind,
      distanceKm,
      address: buildAddress(el.tags),
    });
  }

  return candidates;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = parseNum(searchParams.get("lat"));
  const lon = parseNum(searchParams.get("lon"));
  const radiusRequested = parseNum(searchParams.get("radius_m"));

  if (lat === null || lon === null) {
    return NextResponse.json({ error: "invalid_coordinates" }, { status: 400 });
  }

  const safeLat = clamp(lat, -90, 90);
  const safeLon = clamp(lon, -180, 180);
  const radiusM = clamp(radiusRequested ?? 7000, 1000, 25000);
  const key = cacheKey(safeLat, safeLon, radiusM);
  const now = Date.now();
  const freshCache = inMemoryCache.get(key);
  if (freshCache && now - freshCache.ts < CACHE_TTL_MS) {
    return NextResponse.json(freshCache.payload);
  }

  let hadAnySuccess = false;
  let lastFailure = "overpass_failed";

  for (const searchRadius of buildSearchRadii(radiusM)) {
    try {
      const json = await fetchOverpass(buildOverpassQuery(safeLat, safeLon, searchRadius));
      hadAnySuccess = true;

      const candidates = mapElementsToCandidates(json.elements ?? [], safeLat, safeLon);
      if (candidates.length === 0) continue;

      candidates.sort((a, b) => a.distanceKm - b.distanceKm);
      const best = candidates[0];

      const payload: StorePayload = {
        store: {
          ...best,
          distanceKm: Number(best.distanceKm.toFixed(2)),
        },
        radiusM: searchRadius,
      };

      inMemoryCache.set(key, { ts: now, payload });
      return NextResponse.json(payload);
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : "overpass_failed";
    }
  }

  if (hadAnySuccess) {
    const payload: StorePayload = { store: null, radiusM };
    inMemoryCache.set(key, { ts: now, payload });
    return NextResponse.json(payload);
  }

  const staleCache = inMemoryCache.get(key);
  if (staleCache && now - staleCache.ts < STALE_CACHE_TTL_MS && staleCache.payload.store) {
    return NextResponse.json(staleCache.payload);
  }

  return NextResponse.json({ error: "overpass_failed", detail: lastFailure }, { status: 502 });
}
