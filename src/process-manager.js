/**
 * ProcessManager - Shared utility for tracking active child processes
 *
 * Provides centralized process tracking to prevent memory leaks
 * when spawning agent CLI processes across different modules.
 */

import { spawn } from 'node:child_process';

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

  async spawnProcess(agent, prompt, options = {}) {
    const {
      timeout = agent.timeoutMs || 120000,
      onStdout = null,
      onStderr = null
    } = options;

    const args = agent.args.map(a => a.replace('{PROMPT}', prompt));

    return new Promise((resolve, reject) => {
      const proc = spawn(agent.cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.add(agent.id, proc);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        if (onStdout) {
          onStdout(text);
        }
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        if (onStderr) {
          onStderr(text);
        }
      });

      let settled = false;
      let timedOut = false;
      const settle = (fn, val) => {
        if (!settled) {
          settled = true;
          fn(val);
        }
      };

      const cleanup = () => {
        this.delete(agent.id);
      };

      proc.on('close', (code) => {
        if (!timedOut) clearTimeout(timeoutId);
        cleanup();
        settle(resolve, { ok: code === 0, output: stdout, error: stderr });
      });

      proc.on('error', (err) => {
        if (!timedOut) clearTimeout(timeoutId);
        cleanup();
        settle(reject, err);
      });

      const timeoutId = setTimeout(() => {
        timedOut = true;
        cleanup();
        settle(reject, new Error(`Process killed by timeout after ${timeout}ms`));
      }, timeout);
    });
  }
}

// Singleton instance for global use
const globalProcessManager = new ProcessManager();

export function getProcessManager() {
  return globalProcessManager;
}
