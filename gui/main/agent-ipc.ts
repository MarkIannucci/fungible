import { ipcMain } from 'electron';
import { runAgentTurn } from '../../core/agent.js';
import type { Message } from '../../core/llm-provider.js';
import { detectProvider, getProviderModel } from '../../core/llm-provider.js';

// Conversation history lives in main (core mutates it in place across turns);
// the renderer keeps only a display transcript.
const history: Message[] = [];
const pendingConfirms = new Map<number, (yes: boolean) => void>();
let nextConfirmId = 1;
let inflight = false;

export function registerAgentIpc() {
  ipcMain.handle('agent:provider', () => {
    try {
      const p = detectProvider();
      return `${p}/${getProviderModel(p).split('-').slice(0, 3).join('-')}`;
    } catch {
      return null;
    }
  });

  ipcMain.handle('agent:reset', () => {
    if (inflight) return; // clearing mid-turn would corrupt the streaming turn's history
    history.length = 0;
  });

  ipcMain.handle('agent:run', async (e, userMessage: string) => {
    if (inflight) throw new Error('The agent is already responding — wait for the current turn to finish');
    inflight = true;
    const send = (channel: string, ...args: unknown[]) => {
      if (!e.sender.isDestroyed()) e.sender.send(channel, ...args);
    };
    const historyLenBefore = history.length;
    try {
      await runAgentTurn(userMessage, history, {
        onText: (delta) => send('agent:text', delta),
        onToolCall: (name, desc) => send('agent:tool', name, desc),
        onNavigate: (screen, filter) => send('agent:navigate', screen, filter),
        onConfirm: (desc) =>
          new Promise<boolean>((resolve) => {
            const id = nextConfirmId++;
            pendingConfirms.set(id, resolve);
            send('agent:confirm', id, desc);
          }),
      });
    } catch (err) {
      history.splice(historyLenBefore); // roll back the partial turn
      throw err;
    } finally {
      inflight = false;
      rejectPendingConfirms(); // any confirm still pending belongs to a failed turn
    }
  });

  ipcMain.handle('agent:respond-confirm', (_e, id: number, yes: boolean) => {
    pendingConfirms.get(id)?.(yes);
    pendingConfirms.delete(id);
  });
}

/** Cancel pending confirms (e.g. window closed) so turns don't hang forever. */
export function rejectPendingConfirms() {
  for (const resolve of pendingConfirms.values()) resolve(false);
  pendingConfirms.clear();
}
