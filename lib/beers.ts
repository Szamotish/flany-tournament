type MatchTeams = {
  team_a_id: string | null;
  team_b_id: string | null;
  status: string;
};

export type BeerOfTheDay = {
  name: string;
};

type BeerDefinition = BeerOfTheDay & { labelFile: string };

const BEER_CATALOG: BeerDefinition[] = [
  { name: "Tatra", labelFile: "tatra.png" },
  { name: "\u017Bywiec", labelFile: "zywiec.png" },
  { name: "\u017Bywiec Bia\u0142e", labelFile: "zywiec biale.png" },
  { name: "Warka", labelFile: "warka.png" },
  { name: "Lech", labelFile: "lech.png" },
  { name: "\u0141om\u017Ca", labelFile: "lomza.png" },
  { name: "Tyskie", labelFile: "tyskie.png" },
  { name: "Per\u0142a", labelFile: "perla.png" },
  { name: "Okocim", labelFile: "okocim.png" },
  { name: "Harna\u015B", labelFile: "harnas.png" },
  { name: "Kasztelan", labelFile: "kasztelan.png" },
  { name: "Ksi\u0105\u017C\u0119ce", labelFile: "ksiazece.png" },
  { name: "Kr\u00F3lewskie", labelFile: "krolewskie.png" },
  { name: "Namys\u0142\u00F3w", labelFile: "namyslow.png" },
  { name: "Desperados", labelFile: "desperados.png" },
  { name: "Heineken", labelFile: "heineken.png" },
  { name: "Carlsberg", labelFile: "carlsberg.png" },
  { name: "\u017Bubr", labelFile: "zubr.png" },
  { name: "D\u0119bowe", labelFile: "debowe.png" },
  { name: "Specjal", labelFile: "specjal.png" },
  { name: "EB", labelFile: "eb.png" },
  { name: "Captain Jack", labelFile: "capjack.png" },
  { name: "Guinness", labelFile: "guinness.png" },
  { name: "Kozel", labelFile: "kozel.png" },
  { name: "Pilsner Urquell", labelFile: "pilsner.png" },
  { name: "Budweiser", labelFile: "budweiser.png" },
  { name: "Bud Light", labelFile: "budlight.png" },
  { name: "Beck\u2019s", labelFile: "becks.png" },
  { name: "Paulaner", labelFile: "paulaner.png" },
  { name: "Super Bock", labelFile: "super bock.png" },
  { name: "Perlenbacher", labelFile: "perlenbacher.png" },
  { name: "Argus", labelFile: "argus.png" },
  { name: "Kustosz", labelFile: "kustosz.png" },
  { name: "Karpackie", labelFile: "karpackie.png" },
  { name: "Romper", labelFile: "romper.png" },
  { name: "Brok", labelFile: "brok.png" },
];

export const BEER_LIST: BeerDefinition[] = [...BEER_CATALOG].sort((a, b) => a.name.localeCompare(b.name, "pl"));

function normalizeBeerKey(value: string): string {
  return value
    .replace(/[łŁ]/g, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2019'`\u00B4]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const LABEL_FILE_BY_KEY: Record<string, string> = Object.fromEntries(
  BEER_LIST.map(beer => [normalizeBeerKey(beer.name), beer.labelFile])
);
// Keep the legacy transliterations accepted by older saved profiles.
Object.assign(LABEL_FILE_BY_KEY, { omza: "lomza.png", pera: "perla.png", namysow: "namyslow.png" });

export function beerLabelPath(beerName: string): string | null {
  const key = normalizeBeerKey(beerName);
  const file = LABEL_FILE_BY_KEY[key] ?? Object.entries(LABEL_FILE_BY_KEY).find(([candidate]) => key.includes(candidate))?.[1];
  return file ? `/models/etykiety clean/${encodeURIComponent(file)}` : null;
}

export function beerOfTheDay(dayKey: string): BeerOfTheDay {
  let hash = 0;
  for (let i = 0; i < dayKey.length; i++) {
    hash = (hash * 33 + dayKey.charCodeAt(i)) >>> 0;
  }
  return BEER_CATALOG[hash % BEER_CATALOG.length];
}

export function isKnownBeerName(value: string): boolean {
  return BEER_LIST.some((beer) => beer.name === value);
}

export function computeBeersFromFinishedMatches(
  matches: MatchTeams[],
  teamSizeMap: Map<string, number>
): number {
  return matches.reduce((sum, m) => {
    if (m.status !== "finished") return sum;
    if (!m.team_a_id || !m.team_b_id) return sum;
    const aSize = teamSizeMap.get(m.team_a_id) ?? 0;
    const bSize = teamSizeMap.get(m.team_b_id) ?? 0;
    return sum + aSize + bSize;
  }, 0);
}
