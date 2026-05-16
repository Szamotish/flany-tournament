import { isKnownBeerName } from "@/lib/beers";
import { supabaseServer } from "@/lib/supabaseServer";

export const APP_BACKGROUND_VARIANTS = ["finn_bmo", "finn_beer"] as const;
export type AppBackgroundVariant = (typeof APP_BACKGROUND_VARIANTS)[number];

const DEFAULT_BACKGROUND: AppBackgroundVariant = "finn_bmo";
const SETTINGS_TABLE = "app_settings";
const BACKGROUND_KEY = "background";
const BEER_OF_DAY_KEY = "beer_of_day";

function isVariant(value: unknown): value is AppBackgroundVariant {
  return typeof value === "string" && (APP_BACKGROUND_VARIANTS as readonly string[]).includes(value);
}

function isMissingSettingsSchemaError(message: string): boolean {
  return message.includes(SETTINGS_TABLE);
}

async function readSettingValue(settingKey: string): Promise<string | null> {
  const read = await supabaseServer
    .from(SETTINGS_TABLE)
    .select("value_text")
    .eq("key", settingKey)
    .maybeSingle();

  if (read.error) {
    if (isMissingSettingsSchemaError(read.error.message)) return null;
    throw new Error(read.error.message);
  }

  return typeof read.data?.value_text === "string" ? read.data.value_text : null;
}

async function writeSettingValue(settingKey: string, valueText: string | null): Promise<void> {
  const write = await supabaseServer
    .from(SETTINGS_TABLE)
    .upsert(
      { key: settingKey, value_text: valueText, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );

  if (write.error) {
    if (isMissingSettingsSchemaError(write.error.message)) {
      throw new Error("missing_app_settings_schema");
    }
    throw new Error(write.error.message);
  }
}

export async function readAppBackground(): Promise<AppBackgroundVariant> {
  const value = await readSettingValue(BACKGROUND_KEY);
  return isVariant(value) ? value : DEFAULT_BACKGROUND;
}

export async function writeAppBackground(background: AppBackgroundVariant): Promise<void> {
  await writeSettingValue(BACKGROUND_KEY, background);
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
  const value = await readSettingValue(BEER_OF_DAY_KEY);
  if (!value) return null;
  return isKnownBeerName(value) ? value : null;
}

export async function writeConfiguredBeerOfDay(beerOfDay: string | null): Promise<void> {
  await writeSettingValue(BEER_OF_DAY_KEY, beerOfDay);
}

