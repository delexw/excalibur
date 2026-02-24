/**
 * ProcessManager - Shared utility for tracking active child processes
 *
 * Provides centralized process tracking to prevent memory leaks
 * when spawning agent CLI processes across different modules.
 */

export class ProcessManager {
  constructor() {
    this.processes = new Map();
  }

  add(agentId, process) {
    this.processes.set(agentId, process);
  }

  _killProcesses(signal, agentId = null, timeoutMs = 1000) {
    const toKill = [];

    const tryKill = (proc, sig) => {
      try {
        proc.kill(sig);
      } catch (err) {
        // Ignore
      }
    };

    for (const [id, proc] of this.processes.entries()) {
      if (agentId && id !== agentId) continue;
      if (!proc.killed) {
        tryKill(proc, signal);

        if (signal === 'SIGTERM') {
          toKill.push(proc);
        }
      }
    }

    if (toKill.length > 0 && timeoutMs > 0) {
      setTimeout(() => {
        for (const proc of toKill) {
          if (!proc.killed) {
            tryKill(proc, 'SIGKILL');
          }
        }
      }, timeoutMs);
    }
  }

  delete(agentId) {
    this._killProcesses('SIGTERM', agentId);
    this.processes.delete(agentId);
  }

  has(agentId) {
    return this.processes.has(agentId);
  }

  get(agentId) {
    return this.processes.get(agentId);
  }

  get size() {
    return this.processes.size;
  }

  clear() {
    this.killAll();
    this.processes.clear();
  }

  forEach(callback) {
    this.processes.forEach(callback);
  }

  killAll(signal = 'SIGTERM') {
    this._killProcesses(signal);
  }

  *[Symbol.iterator]() {
    yield* this.processes.values();
  }
}

// Singleton instance for global use
const globalProcessManager = new ProcessManager();

export function getProcessManager() {
  return globalProcessManager;
}
