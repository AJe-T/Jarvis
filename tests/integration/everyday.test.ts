import { describe, expect, it } from 'vitest';
import { localDay } from '@main/lib/util';
import type { ToolResultBlockParam } from '@main/llm/types';
import { detectTownFromIp } from '@main/tools/everyday/weather';
import { idle, setupServices } from './helpers';

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

function weatherFetch(requests: string[]) {
  return (async (url: string) => {
    requests.push(url);
    if (url.includes('geocoding'))
      return json({
        results: [
          {
            name: 'Hyderabad',
            latitude: 25.4,
            longitude: 68.4,
            country: 'Pakistan',
            admin1: 'Sindh',
          },
          {
            name: 'Hyderabad',
            latitude: 17.38,
            longitude: 78.46,
            country: 'India',
            admin1: 'Telangana',
          },
        ],
      });
    return json({
      current: {
        temperature_2m: 28.4,
        apparent_temperature: 31,
        relative_humidity_2m: 70,
        precipitation: 0,
        weather_code: 2,
        wind_speed_10m: 9,
      },
      daily: {
        time: ['2026-10-07', '2026-10-08'],
        weather_code: [61, 0],
        temperature_2m_max: [31, 32],
        temperature_2m_min: [22, 23],
        precipitation_probability_max: [80, 5],
      },
    });
  }) as typeof fetch;
}

/** The last tool_result block sent back in a chat turn (background calls like titles skipped). */
const lastResult = (t: ReturnType<typeof setupServices>): ToolResultBlockParam | undefined => {
  const chat = t.llm.calls.filter((c) => JSON.stringify(c.system).includes('You are JARVIS'));
  const content = chat.at(-1)?.messages.at(-1)?.content as ToolResultBlockParam[] | undefined;
  return content?.[0];
};

const toolResult = (t: ReturnType<typeof setupServices>, name: string): string => {
  const call = t.services.toolCalls.list(20).find((r) => r.tool_name === name);
  return `${call?.status} ${call?.output_preview ?? ''}`;
};

describe('everyday tools (ideas from isair/jarvis)', () => {
  it('weather uses the home town, prefers the named country, and reports Open-Meteo data', async () => {
    const requests: string[] = [];
    const t = setupServices(
      {
        rules: [
          {
            match: 'weather',
            steps: [
              { tools: [{ name: 'get_weather', input: { days: 2 } }] },
              { text: 'Partly cloudy, sir.' },
            ],
          },
        ],
      },
      { fetch: weatherFetch(requests) },
    );
    t.services.settings.set('location.home', 'Hyderabad, India');
    t.services.orchestrator.send({ text: "what's the weather", source: 'text' });
    await idle(t.services);
    expect(requests[0]).toContain('name=Hyderabad');
    expect(requests[1]).toMatch(/latitude=17\.38&longitude=78\.46/);
    const out = toolResult(t, 'get_weather');
    expect(out).toMatch(/^success Hyderabad, Telangana, India/);
    expect(out).toMatch(/partly cloudy, 28\.4°C/);
    expect(out).toMatch(/2026-10-07: light rain, 22–31°C, rain chance 80%/);
  });

  it('weather without a place or home town asks for one', async () => {
    const t = setupServices(
      {
        rules: [
          {
            match: 'weather',
            steps: [{ tools: [{ name: 'get_weather', input: {} }] }, { text: 'Where, sir?' }],
          },
        ],
      },
      { fetch: weatherFetch([]) },
    );
    t.services.orchestrator.send({ text: 'weather?', source: 'text' });
    await idle(t.services);
    expect(JSON.stringify(lastResult(t))).toMatch(/no home town is set/);
  });

  it('meal log: log, totals against the target, delete', async () => {
    const t = setupServices({
      rules: [
        {
          match: 'dosa',
          steps: [
            {
              tools: [
                {
                  name: 'log_meal',
                  input: {
                    description: 'masala dosa',
                    calories: 450,
                    protein_g: 10,
                    carbs_g: 60,
                    fat_g: 18,
                  },
                },
                { name: 'log_meal', input: { description: 'filter coffee', calories: 120 } },
                { name: 'list_meals', input: { day: 'today' } },
              ],
            },
            { text: 'Logged, sir.' },
          ],
        },
      ],
    });
    t.services.settings.set('nutrition.dailyCalories', 2000);
    t.services.orchestrator.send({ text: 'I had a dosa and coffee', source: 'text' });
    await idle(t.services);
    expect(toolResult(t, 'list_meals')).toMatch(
      /Total .*: 570 kcal \(target 2000, 1430 left\); protein 10 g/,
    );
    const rows = t.services.meals.byDay(localDay());
    expect(rows).toHaveLength(2);
    expect(t.services.meals.remove(rows[0]?.id ?? '')).toBe(true);
    expect(t.services.meals.byDay(localDay())).toHaveLength(1);
  });

  it('look_at_screen asks first, then sends one screenshot as untrusted content', async () => {
    const t = setupServices({
      rules: [
        {
          match: 'screen',
          steps: [
            { tools: [{ name: 'look_at_screen', input: {} }] },
            { text: 'It is a code editor, sir.' },
          ],
        },
      ],
    });
    const asked: string[] = [];
    t.services.confirmShowListeners.add((e) => {
      asked.push(e.title);
      t.services.broker.respond(e.requestId, 'approve', 'click');
    });
    t.services.orchestrator.send({ text: "what's on my screen", source: 'text' });
    await idle(t.services);
    expect(asked).toEqual(['Let Jarvis see your screen?']);
    const result = lastResult(t);
    expect(JSON.stringify(result?.content)).toContain('"type":"image"');
    expect(JSON.stringify(result?.content)).toMatch(/untrusted/i);
  });

  it('town detection is a single opt-in lookup', async () => {
    const town = await detectTownFromIp(async () =>
      json({ city: 'Hyderabad', region: 'Telangana', country_name: 'India' }),
    );
    expect(town).toBe('Hyderabad, India');
  });
});
