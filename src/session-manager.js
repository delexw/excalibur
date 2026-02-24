import fs from 'node:fs';
import path from 'node:path';

/**
 * SessionManager - Responsible for managing session history
 */
export class SessionManager {
  constructor(options = {}) {
    this.history = [];
    this.agents = options.agents || [];
  }

  addToHistory(command, result) {
    this.history.push({
      timestamp: new Date().toISOString(),
      command,
      result: result ? 'success' : 'failed'
    });
  }

  getHistory() {
    return [...this.history];
  }
}
