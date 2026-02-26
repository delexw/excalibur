import type { Agent, HistoryEntry, SessionManagerOptions } from './types.js';

/**
 * SessionManager - Responsible for managing session history
 */
export class SessionManager {
  history: HistoryEntry[];
  agents: Agent[];

  constructor(options: SessionManagerOptions = {}) {
    this.history = [];
    this.agents = options.agents || [];
  }

  addToHistory(command: string, result: boolean): void {
    this.history.push({
      timestamp: new Date().toISOString(),
      command,
      result: result ? 'success' : 'failed'
    });
  }

  getHistory(): HistoryEntry[] {
    return [...this.history];
  }
}
