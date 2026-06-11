import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { BEER_LIST, beerOfTheDay, computeBeersFromFinishedMatches } from "@/lib/beers";
import { readConfiguredBeerOfDay } from "@/lib/appBackground";
import BeerCan3D from "@/app/components/BeerCan3D";
import NearbyLiquorCompassCard from "@/app/components/NearbyLiquorCompassCard";
import MagicOracle from "@/app/components/MagicOracle";

export const dynamic = "force-dynamic";

type WeatherData = {
  temp: number;
  apparent: number;
  wind: number;
  weatherCode: number;
  min: number;
  max: number;
  dayLabel: string;
} | null;

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
  const configuredBeer = await readConfiguredBeerOfDay();
  const beer = configuredBeer ? { name: configuredBeer } : beerOfTheDay(warsawDay);
  const degree = "\u00B0C";

  const [playersRes, tournamentsCountRes, finishedMatchesRes, weather] = await Promise.all([
    supabaseServer.from("players").select("id,name", { count: "exact" }).eq("active", true),
    supabaseServer.from("tournaments").select("id", { count: "exact", head: true }),
    supabaseServer.from("tournament_matches").select("team_a_id,team_b_id,status").eq("status", "finished"),
    fetchSarbskWeather(),
  ]);

  const playersCount = playersRes.count ?? playersRes.data?.length ?? 0;
  const playerNames = (playersRes.data ?? [])
    .map((player) => String(player.name ?? "").trim())
    .filter(Boolean);
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
    const { data: members } = await supabaseServer
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

          <NearbyLiquorCompassCard />

          <MagicOracle
            playerNames={playerNames}
            beerNames={BEER_LIST.map((item) => item.name)}
            beerOfDay={beer.name}
          />

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
        </section>
      </div>
    </main>
  );
}



