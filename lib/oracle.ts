export type OracleContext = {
  playerNames: string[];
  beerNames: string[];
  beerOfDay?: string | null;
  now?: Date;
};

type OracleCategory =
  | "blocked"
  | "best_player"
  | "best_beer"
  | "food"
  | "time"
  | "party"
  | "default";

const PARTY_WORDS = [
  "flan",
  "flany",
  "flanki",
  "piw",
  "browar",
  "browca",
  "alko",
  "alkohol",
  "wodk",
  "wódk",
  "whisky",
  "rum",
  "wino",
  "drinka",
  "drink",
  "najeb",
  "napic",
  "napić",
  "picie",
  "imprez",
  "balet",
  "melanz",
  "melanż",
];

const BLOCKED_WORDS = [
  "zle sie czuje",
  "źle się czuję",
  "zle się czuje",
  "źle sie czuję",
  "chor",
  "lekarz",
  "lek",
  "szpital",
  "boli",
  "depres",
  "samopoczuc",
  "problem",
  "problemy",
  "nie chce mi sie zyc",
  "nie chce mi się żyć",
];

const FOOD_WORDS = ["jesc", "jeść", "jedzenie", "zjesc", "zjeść", "glod", "głód", "pizza", "kebab", "obiad", "kolacja"];
const TIME_WORDS = ["jaki dzien", "jaki dzień", "ktory dzien", "który dzień", "dzisiaj", "jutro", "data", "godzina", "weekend"];

const PARTY_ANSWERS = [
  "Tak. Piwko i flany.",
  "Oczywiscie. Gramy.",
  "Tak. Puszka czeka.",
  "Piwko najpierw.",
  "Flany to dobry plan.",
  "Tak. Bez dyskusji.",
];

const DEFAULT_ANSWERS = [
  "Napij sie piwka.",
  "Zagraj we flany.",
  "Puszka na srodek.",
  "Flany to odpowiedz.",
  "Piwko wyjasni sprawe.",
  "Najpierw flany.",
];

const FOOD_ANSWERS = [
  "Najedz sie i graj.",
  "Szama przed flanami.",
  "Pelny brzuch, pewna reka.",
  "Zjedz, potem puszka.",
];

const TIME_SUFFIXES = [
  "dobry dzien na piwko.",
  "dobry dzien na flany.",
  "puszka sprzyja.",
  "mozna zagrac.",
];

const DAY_LABELS = ["niedziela", "poniedzialek", "wtorek", "sroda", "czwartek", "piatek", "sobota"];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(value: string, words: string[]): boolean {
  return words.some((word) => value.includes(normalize(word)));
}

function pick<T>(values: T[], fallback: T): T {
  if (values.length === 0) return fallback;
  return values[Math.floor(Math.random() * values.length)] ?? fallback;
}

function classify(question: string): OracleCategory {
  const normalized = normalize(question);
  if (!normalized) return "default";
  if (includesAny(normalized, BLOCKED_WORDS)) return "blocked";
  if (normalized.includes("najlepsz") && normalized.includes("gracz")) return "best_player";
  if (normalized.includes("najlepsz") && (normalized.includes("piw") || normalized.includes("browar"))) return "best_beer";
  if (includesAny(normalized, FOOD_WORDS)) return "food";
  if (includesAny(normalized, TIME_WORDS)) return "time";
  if (includesAny(normalized, PARTY_WORDS)) return "party";
  return "default";
}

export function answerOracle(question: string, context: OracleContext): string {
  const category = classify(question);
  const now = context.now ?? new Date();

  if (category === "blocked") return "Relax";

  if (category === "best_player") {
    const player = pick(context.playerNames, "ten z puszka");
    return `Dzisiaj ${player}.`;
  }

  if (category === "best_beer") {
    const beerPool = context.beerOfDay ? [context.beerOfDay, ...context.beerNames] : context.beerNames;
    const beer = pick(beerPool, "zimne");
    return `${beer}. Bez pytan.`;
  }

  if (category === "food") {
    return pick(FOOD_ANSWERS, FOOD_ANSWERS[0]);
  }

  if (category === "time") {
    const day = DAY_LABELS[now.getDay()] ?? "dzisiaj";
    return `${day}: ${pick(TIME_SUFFIXES, TIME_SUFFIXES[0])}`;
  }

  if (category === "party") {
    return pick(PARTY_ANSWERS, PARTY_ANSWERS[0]);
  }

  return pick(DEFAULT_ANSWERS, DEFAULT_ANSWERS[0]);
}
