import { promises as fs } from "fs";
import path from "path";
import { isKnownBeerName } from "@/lib/beers";

export const APP_BACKGROUND_VARIANTS = ["finn_bmo", "finn_beer"] as const;
export type AppBackgroundVariant = (typeof APP_BACKGROUND_VARIANTS)[number];

const DEFAULT_BACKGROUND: AppBackgroundVariant = "finn_bmo";
const SETTINGS_DIR = path.join(process.cwd(), "data");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "app-settings.json");

type AppSettingsPayload = {
  background?: unknown;
  beerOfDay?: unknown;
};

function isVariant(value: unknown): value is AppBackgroundVariant {
  return typeof value === "string" && (APP_BACKGROUND_VARIANTS as readonly string[]).includes(value);
}

async function readRawSettings(): Promise<AppSettingsPayload> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf8");
    return JSON.parse(raw) as AppSettingsPayload;
  } catch {
    return {};
  }
}

async function writeRawSettings(payload: { background: AppBackgroundVariant; beerOfDay: string | null }): Promise<void> {
  await fs.mkdir(SETTINGS_DIR, { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(payload, null, 2), "utf8");
}

export async function readAppBackground(): Promise<AppBackgroundVariant> {
  const parsed = await readRawSettings();
  if (isVariant(parsed.background)) return parsed.background;
  return DEFAULT_BACKGROUND;
}

export async function writeAppBackground(background: AppBackgroundVariant): Promise<void> {
  const parsed = await readRawSettings();
  const beerOfDay = typeof parsed.beerOfDay === "string" && isKnownBeerName(parsed.beerOfDay) ? parsed.beerOfDay : null;
  await writeRawSettings({ background, beerOfDay });
}

export function normalizeAppBackground(value: unknown): AppBackgroundVariant | null {
  return isVariant(value) ? value : null;
}

export function normalizeConfiguredBeerOfDay(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!isKnownBeerName(trimmed)) return undefined;
  return trimmed;
}

export async function readConfiguredBeerOfDay(): Promise<string | null> {
  const parsed = await readRawSettings();
  if (typeof parsed.beerOfDay === "string" && isKnownBeerName(parsed.beerOfDay)) {
    return parsed.beerOfDay;
  }
  return null;
}

export async function writeConfiguredBeerOfDay(beerOfDay: string | null): Promise<void> {
  const parsed = await readRawSettings();
  const background = isVariant(parsed.background) ? parsed.background : DEFAULT_BACKGROUND;
  await writeRawSettings({ background, beerOfDay });
}
