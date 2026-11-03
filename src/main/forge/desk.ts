import { isDefaultName } from '@shared/assistant-name';
import type { EventChannel } from '@shared/ipc-channels';
import type { EventPayload } from '@shared/ipc-contract';
import type { TurnContext } from '../agent/agent-loop';
import { restrictTools, runOnBrain } from '../agent/brain-runner';
import { errorMessage } from '../errors';
import { newId } from '../lib/util';
import { logger } from '../logging/logger';
import type { VaultService } from '../memory/vault-service';
import type { Services } from '../services';
import { createSpaces, createSpacesTool } from '../spaces/spaces';
import { createForgeChat, isDeskTool, type ForgeChat } from './chat';
import { createForgeChatTools } from './chat-tools';
import { runView } from './forge';
import { createForgeStore, FORGE_SPACES, type ForgeStore } from './memory';

/**
 * F9–F10 wiring: Forge's store (its corner of the vault), the Forge desk (chat), its notebooks
 * (`forge_spaces`) and the tools around them. Kept out of index.ts so the isolation is in one place:
 * the desk runs with `restrictTools(…, isDeskTool)` and a prompt built only from Forge's own data.
 */

const STEPS = 12;
const TOKENS = 3000;

const DESK_ONLY =
  "Only the Forge desk writes Forge's notebooks. Read them with forge_memory (path Forge/Spaces).";

export interface ForgeDesk {
  chat: ForgeChat;
  store: ForgeStore;
  isDesk(conversationId: string): boolean;
}

export function createForgeDesk(
  s: Services,
  o: {
    vault: () => VaultService | null;
    emit<E extends EventChannel>(event: E, payload: EventPayload<E>): void;
    /** Shows the main window on the Forge page. */
    openForge(): void;
  },
): ForgeDesk {
  const log = logger.child({ module: 'forge-desk' });
  const store = createForgeStore(o.vault);
  let abort = new AbortController();
  s.killSwitch.onKill(() => {
    abort.abort();
    abort = new AbortController();
  });

  // One hidden, private conversation per launch holds the desk's tool calls and costs (never listed
  // with Sir's chats, never searched by Jarvis's memory: is_private and kind 'forge').
  let deskId: string | null = null;
  const desk = (): string => (deskId ??= s.conversations.create('text', true, 'forge').id);
  const isDesk = (id: string): boolean =>
    id === deskId || s.conversations.get(id)?.kind === 'forge';

  const head = (): string => {
    const n = s.settings.get('assistant.name');
    return isDefaultName(n) ? 'Jarvis' : n;
  };

  const chat = createForgeChat({
    store,
    async reply(t) {
      const turn: TurnContext = {
        turnId: newId('t_'),
        conversationId: desk(),
        mode: 'text',
        purpose: 'task',
        signal: abort.signal,
        // The desk's chat is never for the free pool, and run output it read is outside content.
        taint: {
          tainted: t.tainted,
          ...(t.tainted ? { source: 'Forge run output' } : {}),
          privateSource: 'the Forge chat',
        },
      };
      const r = await runOnBrain(s, 'jarvis', {
        system: t.system,
        prompt: t.prompt,
        // The whole isolation rule in one line: the desk gets Forge's tools and nothing else.
        tools: restrictTools(s.tools, isDeskTool),
        maxSteps: STEPS,
        maxTokens: TOKENS,
        turn,
      });
      return { text: r.text, tainted: turn.taint.tainted };
    },
    status: () => s.forge.status(),
    assistantName: head,
    onMessage: (message) => o.emit('forge:message', { message }),
    announce: (text) => s.announce('Forge', text),
    log: (msg, err) => log.warn(err ? { err: errorMessage(err) } : {}, msg),
  });

  // Runs post to the chat and the page as they move (forge.ts onUpdate).
  s.forgeListeners.add((r) => {
    chat.onRun(r);
    const view = runView(r);
    if (view) o.emit('forge:update', { run: view });
  });

  // F10: Forge's own notebooks, in <vault>/Forge/Spaces; only the desk writes them.
  const vault = o.vault();
  if (vault) {
    const spaces = createSpaces({
      vault,
      settings: s.settings,
      onChanged: (paths) => o.emit('memory:changed', { vaultPaths: paths }),
      root: FORGE_SPACES,
      iconsKey: 'forge.spaceIcons',
    });
    s.registry.register(
      createSpacesTool(spaces, {
        name: 'forge_spaces',
        description:
          "The Forge desk's own notebooks (plans, specs and designs for building Jarvis), in Forge/Spaces, apart from sir's Spaces. action=list_spaces; list_pages (space); read_page (space, page); append (space, page, text: adds to the end, creates the page if missing); create_page (space, page, text). Forge desk only; never delete or overwrite.",
        refuse: (ctx) => (isDesk(ctx.conversationId) ? null : DESK_ONLY),
      }),
    );
  }
  for (const tool of createForgeChatTools({
    chat,
    store,
    isDesk,
    lastUserMessage: (conversationId) => {
      const last = s.conversations
        .messages(conversationId)
        .filter((m) => m.role === 'user' && m.text_plain.trim())
        .at(-1);
      return last
        ? { text: last.text_plain, source: last.source === 'voice' ? 'voice' : 'text' }
        : null;
    },
    openForge: o.openForge,
  }))
    s.registry.register(tool);

  return { chat, store, isDesk };
}
