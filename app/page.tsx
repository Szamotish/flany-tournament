import Link from "next/link";
import { supabasePublic } from "@/lib/supabasePublic";
import { computeBeersFromFinishedMatches } from "@/lib/beers";
import BeerCan3D from "@/app/components/BeerCan3D";
import NearbyLiquorCompassCard from "@/app/components/NearbyLiquorCompassCard";

type BeerOfTheDay = {
  name: string;
};

type WeatherData = {
  temp: number;
  apparent: number;
  wind: number;
  weatherCode: number;
  min: number;
  max: number;
  dayLabel: string;
} | null;

const BEER_LIST: BeerOfTheDay[] = [
  { name: "Tatra" },
  { name: "\u017Bywiec" },
  { name: "Warka" },
  { name: "Lech" },
  { name: "\u0141om\u017Ca" },
  { name: "Tyskie" },
  { name: "Per\u0142a" },
  { name: "Okocim" },
  { name: "Harna\u015B" },
  { name: "Kasztelan" },
  { name: "Ksi\u0105\u017C\u0119ce" },
  { name: "Kr\u00F3lewskie" },
  { name: "Namys\u0142\u00F3w" },
  { name: "Desperados" },
  { name: "Heineken" },
  { name: "Carlsberg" },
  { name: "\u017Bubr" },
  { name: "D\u0119bowe" },
  { name: "Specjal" },
  { name: "EB" },
  { name: "Captain Jack" },
  { name: "Guinness" },
  { name: "Kozel" },
  { name: "Pilsner Urquell" },
  { name: "Budweiser" },
  { name: "Bud Light" },
  { name: "Beck\u2019s" },
  { name: "Paulaner" },
  { name: "Super Bock" },
  { name: "Perlenbacher" },
  { name: "Argus" },
  { name: "Kustosz" },
  { name: "Karpackie" },
  { name: "Romper" },
  { name: "Brok" },
];

const WEATHER_LABELS: Record<number, string> = {
  0: "Bezchmurnie",
  1: "Prawie bezchmurnie",
  2: "Lekko pochmurno",
  3: "Pochmurno",
  45: "Mgla",
  48: "Mgla osadzajaca",
  51: "Lekka mzawka",
  53: "Mzawka",
  55: "Mocna mzawka",
  61: "Lekki deszcz",
  63: "Deszcz",
  65: "Mocny deszcz",
  71: "Lekki snieg",
  73: "Snieg",
  75: "Mocny snieg",
  80: "Przelotny deszcz",
  81: "Przelotny deszcz",
  82: "Mocny przelotny deszcz",
  95: "Burza",
  96: "Burza z gradem",
  99: "Silna burza z gradem",
};

function beerOfTheDay(dayKey: string): BeerOfTheDay {
  let hash = 0;
  for (let i = 0; i < dayKey.length; i++) {
    hash = (hash * 33 + dayKey.charCodeAt(i)) >>> 0;
  }
  return BEER_LIST[hash % BEER_LIST.length];
}

function weatherLabel(code: number): string {
  return WEATHER_LABELS[code] ?? "Warunki zmienne";
}

async function fetchSarbskWeather(): Promise<WeatherData> {
  try {
    const url =
      "https://api.open-meteo.com/v1/forecast?latitude=54.747&longitude=17.556&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_min,temperature_2m_max&timezone=Europe%2FWarsaw&forecast_days=1";

    const res = await fetch(url, {
      next: { revalidate: 1800 },
    });
    if (!res.ok) return null;

    const json = (await res.json()) as {
      current?: {
        temperature_2m?: number;
        apparent_temperature?: number;
        weather_code?: number;
        wind_speed_10m?: number;
      };
      daily?: {
        temperature_2m_min?: number[];
        temperature_2m_max?: number[];
        time?: string[];
      };
    };

    const temp = Number(json.current?.temperature_2m ?? NaN);
    const apparent = Number(json.current?.apparent_temperature ?? NaN);
    const weatherCode = Number(json.current?.weather_code ?? NaN);
    const wind = Number(json.current?.wind_speed_10m ?? NaN);
    const min = Number(json.daily?.temperature_2m_min?.[0] ?? NaN);
    const max = Number(json.daily?.temperature_2m_max?.[0] ?? NaN);
    const dateRaw = json.daily?.time?.[0];

    if (
      !Number.isFinite(temp) ||
      !Number.isFinite(apparent) ||
      !Number.isFinite(weatherCode) ||
      !Number.isFinite(wind) ||
      !Number.isFinite(min) ||
      !Number.isFinite(max) ||
      !dateRaw
    ) {
      return null;
    }

    const dayLabel = new Date(dateRaw).toLocaleDateString("pl-PL", { weekday: "long" });
    return { temp, apparent, weatherCode, wind, min, max, dayLabel };
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const warsawDay = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Warsaw" });
  const beer = beerOfTheDay(warsawDay);
  const degree = "\u00B0C";

  const [playersCountRes, tournamentsCountRes, finishedMatchesRes, weather] = await Promise.all([
    supabasePublic.from("players").select("id", { count: "exact", head: true }).eq("active", true),
    supabasePublic.from("tournaments_public").select("id", { count: "exact", head: true }),
    supabasePublic.from("tournament_matches").select("team_a_id,team_b_id,status").eq("status", "finished"),
    fetchSarbskWeather(),
  ]);

  const playersCount = playersCountRes.count ?? 0;
  const tournamentsCount = tournamentsCountRes.count ?? 0;
  const finishedTeamMatches = (finishedMatchesRes.data ?? []).map((m) => ({
    team_a_id: typeof m.team_a_id === "string" ? m.team_a_id : null,
    team_b_id: typeof m.team_b_id === "string" ? m.team_b_id : null,
    status: "finished",
  }));

  const allTeamIds = Array.from(
    new Set(
      finishedTeamMatches
        .flatMap((m) => [m.team_a_id, m.team_b_id])
        .filter((id): id is string => Boolean(id))
    )
  );

  const teamSizeMap = new Map<string, number>();
  if (allTeamIds.length > 0) {
    const { data: members } = await supabasePublic
      .from("team_members")
      .select("team_id")
      .in("team_id", allTeamIds);

    for (const member of members ?? []) {
      const teamId = String(member.team_id ?? "");
      if (!teamId) continue;
      teamSizeMap.set(teamId, (teamSizeMap.get(teamId) ?? 0) + 1);
    }
  }

  const totalBeers = computeBeersFromFinishedMatches(finishedTeamMatches, teamSizeMap);

  return (
    <main className="landing-root">
      <div className="foam-layer" aria-hidden />
      <div className="grain-layer" aria-hidden />

      <div className="landing-shell">
        <section className="landing-grid">
          <article className="glass-card landing-main">
            <h1 className="landing-title">Flanki League</h1>

            <div className="landing-link-list">
              <Link href="/tournaments" className="landing-link-card">
                <span className="landing-link-title">Turnieje</span>
                <span className="landing-link-sub">Lista turniejow i podglad drabinek</span>
              </Link>

              <Link href="/players" className="landing-link-card">
                <span className="landing-link-title">Zawodnicy</span>
                <span className="landing-link-sub">Profile zawodnikow, oceny i historia</span>
              </Link>
            </div>
          </article>

          <article className="glass-card landing-beer">
            <p className="panel-top-label">Piwo dnia</p>
            <BeerCan3D beer={beer} />
            <p className="beer-name">{beer.name}</p>
          </article>

          <NearbyLiquorCompassCard />

          <article className="glass-card landing-weather">
            <div className="card-head">
              <h2>Pogoda Sarbsk</h2>
              <p>{warsawDay}</p>
            </div>

            {weather ? (
              <div className="weather-block">
                <p className="weather-temp">
                  {Math.round(weather.temp)}
                  {degree}
                </p>
                <p className="weather-label">{weatherLabel(weather.weatherCode)}</p>
                <p className="weather-sub">
                  Odczuwalna {Math.round(weather.apparent)}
                  {degree} - Wiatr {Math.round(weather.wind)} km/h
                </p>
                <p className="weather-sub">
                  {weather.dayLabel}: {Math.round(weather.min)}
                  {degree} - {Math.round(weather.max)}
                  {degree}
                </p>
              </div>
            ) : (
              <p className="weather-sub">Brak danych pogodowych.</p>
            )}
          </article>

          <article className="glass-card landing-stats">
            <div className="card-head">
              <h2>Statystyki ligi</h2>
            </div>
            <div className="stats-grid">
              <div>
                <p className="metric-value">{tournamentsCount}</p>
                <p className="metric-label">Rozegrane turnieje</p>
              </div>
              <div>
                <p className="metric-value">{totalBeers}</p>
                <p className="metric-label">Wypite piwa</p>
              </div>
              <div>
                <p className="metric-value">{playersCount}</p>
                <p className="metric-label">Aktywni zawodnicy</p>
              </div>
            </div>
          </article>
        </section>
      </div>

      <Link href="/admin/tournaments" className="admin-fab" aria-label="Panel main admin">
        Admin
      </Link>
    </main>
  );
}

