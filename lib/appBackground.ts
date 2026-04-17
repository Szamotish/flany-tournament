import { promises as fs } from "fs";
import path from "path";

export const APP_BACKGROUND_VARIANTS = ["finn_bmo", "finn_beer"] as const;
export type AppBackgroundVariant = (typeof APP_BACKGROUND_VARIANTS)[number];

const DEFAULT_BACKGROUND: AppBackgroundVariant = "finn_bmo";
const SETTINGS_DIR = path.join(process.cwd(), "data");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "app-settings.json");

function isVariant(value: unknown): value is AppBackgroundVariant {
  return typeof value === "string" && (APP_BACKGROUND_VARIANTS as readonly string[]).includes(value);
}

export async function readAppBackground(): Promise<AppBackgroundVariant> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw) as { background?: unknown };
    if (isVariant(parsed.background)) return parsed.background;
    return DEFAULT_BACKGROUND;
  } catch {
    return DEFAULT_BACKGROUND;
  }
}

export async function writeAppBackground(background: AppBackgroundVariant): Promise<void> {
  await fs.mkdir(SETTINGS_DIR, { recursive: true });
  const payload = JSON.stringify({ background }, null, 2);
  await fs.writeFile(SETTINGS_FILE, payload, "utf8");
}

export function normalizeAppBackground(value: unknown): AppBackgroundVariant | null {
  return isVariant(value) ? value : null;
}
