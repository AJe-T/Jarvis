import { describe, expect, it } from 'vitest';
import { BrainRefSchema, isConnectionSecret } from '@shared/llm-providers';
import { isProtectedSecret } from '@main/ipc/handlers/mcp';
import { setupServices } from './helpers';

/** A stand-in OpenAI API: the model list and one streamed answer, recording each key used. */
function fakeOpenAi(models: string[]) {
  const keys: string[] = [];
  const fake = (async (url: string | URL, init?: RequestInit) => {
    keys.push(new Headers(init?.headers).get('authorization') ?? '');
    if (String(url).endsWith('/models'))
      return new Response(JSON.stringify({ data: models.map((id) => ({ id })) }), { status: 200 });
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
      'data: [DONE]',
      '',
    ].join('\n');
    return new Response(sse, { status: 200 });
  }) as typeof fetch;
  return { fetch: fake, keys };
}

describe('connections and model registry (integrations step 3)', () => {
  it("lists each provider's own key, adds more keys with their own secrets, and protects them", () => {
    const { services: s } = setupServices();
    expect(s.connections.list().find((c) => c.id === 'conn_openai')).toMatchObject({
      primary: true,
      secret: 'openai',
      keySet: false,
    });
    const work = s.connections.add('openai', 'Work');
    expect(work).toMatchObject({ id: 'conn_openai_2', secret: 'openai_2', primary: false });
    expect(s.connections.add('openai', '').label).toBe('OpenAI (ChatGPT models) (3)');
    expect(isConnectionSecret('openai_2')).toBe(true);
    expect(isProtectedSecret('openai_2')).toBe(true); // a community MCP server can't take it
    expect(isProtectedSecret('ollama_cloud_3')).toBe(true);
    expect(BrainRefSchema.safeParse('conn_openai_2').success).toBe(true);
    expect(BrainRefSchema.safeParse('conn_../x').success).toBe(false);
    for (let i = 0; i < 2; i++) s.connections.add('openai', 'x');
    expect(() => s.connections.add('openai', 'one too many')).toThrow('too many connections');
  });

  it('keeps live, typed and no-longer-listed models apart, with favourites and hidden ones', () => {
    const { services: s } = setupServices();
    const id = s.connections.add('gemini', 'Personal').id;
    s.connections.syncLive(id, ['gemini-3-pro', 'gemini-3-flash', 'bad id!']);
    s.connections.addManual(id, 'gemini-exp');
    s.connections.setFlags(id, 'gemini-3-flash', { favourite: true });
    s.connections.setFlags(id, 'gemini-3-pro', { enabled: false });
    s.connections.syncLive(id, ['gemini-3-flash', 'gemini-exp']); // typed, then listed: still typed
    const byModel = Object.fromEntries(s.connections.get(id).models.map((m) => [m.model, m]));
    expect(byModel['gemini-3-flash']).toMatchObject({ source: 'live', favourite: true });
    expect(byModel['gemini-3-pro']).toMatchObject({ source: 'cached', enabled: false });
    expect(byModel['gemini-exp']?.source).toBe('manual');
    expect(byModel['bad id!']).toBeUndefined();
    expect(s.connections.get(id).models[0]?.model).toBe('gemini-3-flash'); // favourites first
    s.connections.removeModel(id, 'gemini-3-flash'); // live: comes back on refresh, not removable
    s.connections.removeModel(id, 'gemini-3-pro');
    expect(
      s.connections
        .get(id)
        .models.map((m) => m.model)
        .sort(),
    ).toEqual(['gemini-3-flash', 'gemini-exp']);
    expect(() => s.connections.addManual(id, 'rm -rf /; echo')).toThrow();
  });

  it("the provider's own key keeps its model in llm.cloud.models; extra keys keep their own", () => {
    const { services: s } = setupServices();
    s.connections.setModel('conn_openai', 'gpt-5');
    expect(s.settings.get('llm.cloud.models').openai).toBe('gpt-5');
    const id = s.connections.add('openai', 'Work').id;
    s.connections.setModel(id, 'gpt-5-mini');
    expect(s.connections.get(id).model).toBe('gpt-5-mini');
    expect(s.settings.get('llm.cloud.models').openai).toBe('gpt-5');
  });

  it("an extra key is its own brain, called with its own key, and can be Jarvis's main one", async () => {
    const api = fakeOpenAi(['gpt-5', 'gpt-5-mini']);
    const { services: s } = setupServices({ rules: [] }, { fetch: api.fetch });
    s.secrets.set('openai', 'sk-main-1111');
    s.connections.setModel('conn_openai', 'gpt-5');
    const id = s.connections.add('openai', 'Work').id as `conn_${string}`;
    expect(s.brains.ready(id)).toBe(false); // no key, no model yet
    s.secrets.set('openai_2', 'sk-work-2222');
    s.connections.setModel(id, 'gpt-5-mini');
    expect(s.brains.available()).toEqual(expect.arrayContaining(['openai', id]));
    expect(s.brains.label(id)).toBe('OpenAI (ChatGPT models) (Work)');
    expect(s.brains.paid(id)).toBe(true);

    const reply = await s.brains
      .get(id)
      ?.stream(
        { model: 'x', max_tokens: 50, messages: [{ role: 'user', content: 'hi' }] },
        { signal: new AbortController().signal },
      );
    expect(api.keys.at(-1)).toBe('Bearer sk-work-2222');
    expect(reply?.id).toMatch(/^cloud_conn_openai_2_\d+$/); // usage can tell the keys apart

    s.connections.syncLive(id, await s.connectionClient(id).listModels());
    expect(s.connections.get(id).models.map((m) => m.model)).toEqual(['gpt-5', 'gpt-5-mini']);

    s.settings.set('llm.cloud.provider', 'openai');
    expect(s.connections.main()).toBe('conn_openai');
    s.settings.set('llm.cloud.connection', id);
    expect(s.connections.main()).toBe(id);
    s.connections.setModel(id, ''); // not set up any more: the main key answers instead
    expect(s.connections.main()).toBe('conn_openai');
    s.connections.setModel(id, 'gpt-5-mini');
    s.settings.set('llm.cloud.provider', 'gemini'); // a key of another provider isn't used
    expect(s.connections.main()).toBe('conn_gemini');
  });

  it("removing an extra key deletes it; the provider's own one can't be removed", () => {
    const { services: s } = setupServices();
    const id = s.connections.add('groq', 'Spare').id;
    s.secrets.set('groq_2', 'gsk_spare');
    s.settings.set('llm.cloud.connection', id);
    s.connections.remove(id);
    expect(s.secrets.get('groq_2')).toBeUndefined();
    expect(s.settings.get('llm.cloud.connection')).toBe('');
    expect(s.connections.list().some((c) => c.id === id)).toBe(false);
    // Its number is never given to a new key (an NPC naming it must not bill another account).
    expect(s.connections.add('groq', 'New').id).toBe('conn_groq_3');
    expect(s.connections.extraLabels()[id]).toMatch(/removed/);
    expect(() => s.connections.remove('conn_groq')).toThrow('primary connection');
    expect(() => s.connections.get('conn_groq_9')).toThrow('no connection');
  });
});
