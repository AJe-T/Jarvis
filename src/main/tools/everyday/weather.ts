import { z } from 'zod';
import { ToolError } from '../../errors';
import type { SettingsService } from '../../settings/settings-service';
import { defineTool, ok, type Tool } from '../types';

/** Open-Meteo (CC BY 4.0 data, no key): geocoding + forecast. Only the place name and coordinates are sent. */
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
/** Opt-in "detect my town" from the public IP address (Settings button only, never automatic). */
const IP_LOCATE = 'https://ipapi.co/json/';

/** WMO weather codes used by Open-Meteo. */
const WMO: Record<number, string> = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'freezing fog',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'heavy drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  66: 'freezing rain',
  67: 'heavy freezing rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  77: 'snow grains',
  80: 'light showers',
  81: 'showers',
  82: 'violent showers',
  85: 'snow showers',
  86: 'heavy snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm with hail',
  99: 'severe thunderstorm with hail',
};
export const describeWeather = (code: number): string => WMO[code] ?? `weather code ${code}`;

export type Fetch = typeof fetch;

async function getJson<T>(f: Fetch, url: string, signal: AbortSignal): Promise<T> {
  const res = await f(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
  if (!res.ok) throw new ToolError(`The weather service answered ${res.status}. Try again later.`);
  return (await res.json()) as T;
}

interface Place {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}

export async function geocode(f: Fetch, place: string, signal: AbortSignal): Promise<Place> {
  // "Hyderabad, India" → search the town, prefer a result in the named country.
  const [town, ...rest] = place.split(',').map((p) => p.trim());
  const hint = rest.join(' ').toLowerCase();
  const url = `${GEOCODE}?name=${encodeURIComponent(town ?? place)}&count=5&language=en&format=json`;
  const { results } = await getJson<{ results?: Place[] }>(f, url, signal);
  const best =
    (hint &&
      results?.find((r) => `${r.country ?? ''} ${r.admin1 ?? ''}`.toLowerCase().includes(hint))) ||
    results?.[0];
  if (!best) throw new ToolError(`I couldn't find a place called "${place}".`);
  return best;
}

interface Forecast {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    precipitation: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: Array<number | null>;
  };
}

export function createWeatherTools(deps: { settings: SettingsService; fetch?: Fetch }): Tool[] {
  const f = deps.fetch ?? fetch;
  return [
    defineTool({
      name: 'get_weather',
      description:
        "Current weather and a short daily forecast for a place (default: sir's home town from Settings). Use for weather, temperature, rain, umbrella or what-to-wear questions. Returns numbers to summarise briefly.",
      input: z.object({
        place: z.string().min(2).max(120).optional().describe('Town, optionally ", country"'),
        days: z.number().int().min(1).max(7).default(3),
      }),
      tier: 'SAFE',
      timeoutMs: 20_000,
      summarize: ({ place }) => `Check the weather${place ? ` in ${place}` : ''}`,
      async run({ place, days }, ctx) {
        const where = place ?? deps.settings.get('location.home');
        if (!where)
          throw new ToolError(
            'No place given and no home town is set. Ask sir where, or he can set it in Settings → General.',
          );
        const p = await geocode(f, where, ctx.signal);
        const fahrenheit = deps.settings.get('units.temperature') === 'fahrenheit';
        const url =
          `${FORECAST}?latitude=${p.latitude}&longitude=${p.longitude}&timezone=auto&forecast_days=${days}` +
          '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m' +
          '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
          (fahrenheit ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : '');
        const w = await getJson<Forecast>(f, url, ctx.signal);
        const unit = fahrenheit ? '°F' : '°C';
        const wind = fahrenheit ? 'mph' : 'km/h';
        const c = w.current;
        const lines = [
          `${p.name}${p.admin1 ? `, ${p.admin1}` : ''}${p.country ? `, ${p.country}` : ''}`,
          `Now: ${describeWeather(c.weather_code)}, ${c.temperature_2m}${unit} (feels ${c.apparent_temperature}${unit}), humidity ${c.relative_humidity_2m}%, wind ${c.wind_speed_10m} ${wind}, precipitation ${c.precipitation} mm.`,
          ...w.daily.time.map(
            (day, i) =>
              `${day}: ${describeWeather(w.daily.weather_code[i] ?? -1)}, ${w.daily.temperature_2m_min[i]}–${w.daily.temperature_2m_max[i]}${unit}, rain chance ${w.daily.precipitation_probability_max[i] ?? '?'}%.`,
          ),
          'Source: Open-Meteo.',
        ];
        return ok(lines.join('\n'));
      },
    }),
    defineTool({
      name: 'get_location',
      description:
        "Sir's home town as set in Settings (used for weather and local questions). Returns nothing precise; never guess his location otherwise.",
      input: z.object({}).strict(),
      tier: 'SAFE',
      summarize: () => 'Look up your home town',
      async run() {
        const home = deps.settings.get('location.home');
        return ok(home ? `Sir's home town: ${home}.` : 'No home town is set (Settings → General).');
      },
    }),
  ];
}

/** Settings → General "Detect": approximate town from the public IP (opt-in, one request). */
export async function detectTownFromIp(f: Fetch = fetch): Promise<string> {
  const r = await getJson<{ city?: string; region?: string; country_name?: string }>(
    f,
    IP_LOCATE,
    AbortSignal.timeout(10_000),
  );
  if (!r.city) throw new ToolError('Could not work out your town from your internet connection.');
  return [r.city, r.country_name].filter(Boolean).join(', ');
}
