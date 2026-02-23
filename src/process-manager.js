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

  delete(agentId) {
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
    this.processes.clear();
  }

  forEach(callback) {
    this.processes.forEach(callback);
  }

  killAll(signal = 'SIGTERM') {
    for (const proc of this.processes.values()) {
      if (!proc.killed) {
        try {
          proc.kill(signal);
        } catch (err) {
          // Ignore errors during cleanup
        }
      }
    }
    this.clear();
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
