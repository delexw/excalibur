/**
 * ProcessManager - Shared utility for tracking active child processes
 *
 * Provides centralized process tracking to prevent memory leaks
 * when spawning agent CLI processes across different modules.
 */

import { spawn, ChildProcess } from 'node:child_process';
import type { Agent, SpawnOptions, SpawnResult } from './types.js';

export class ProcessManager {
  processes: Map<string, ChildProcess>;

  constructor() {
    this.processes = new Map();
  }

  add(agentId: string, process: ChildProcess): void {
    this.processes.set(agentId, process);
  }

  _killProcesses(signal: string, agentId: string | null = null, timeoutMs = 1000): void {
    const toKill: ChildProcess[] = [];

    const tryKill = (proc: ChildProcess, sig: string): void => {
      try {
        proc.kill(sig as NodeJS.Signals);
      } catch {
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

  delete(agentId: string): void {
    this._killProcesses('SIGTERM', agentId);
    this.processes.delete(agentId);
  }

  has(agentId: string): boolean {
    return this.processes.has(agentId);
  }

  get(agentId: string): ChildProcess | undefined {
    return this.processes.get(agentId);
  }

  get size(): number {
    return this.processes.size;
  }

  clear(): void {
    this.killAll();
    this.processes.clear();
  }

  forEach(callback: (proc: ChildProcess, id: string) => void): void {
    this.processes.forEach(callback);
  }

  killAll(signal = 'SIGTERM'): void {
    this._killProcesses(signal);
  }

  *[Symbol.iterator](): Generator<ChildProcess> {
    yield* this.processes.values();
  }

  async spawnProcess(agent: Agent, prompt: string, options: SpawnOptions = {}): Promise<SpawnResult> {
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

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        if (onStdout) {
          onStdout(text);
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        if (onStderr) {
          onStderr(text);
        }
      });

      let settled = false;
      let timedOut = false;
      const settle = <T>(fn: (val: T) => void, val: T): void => {
        if (!settled) {
          settled = true;
          fn(val);
        }
      };

      const cleanup = (): void => {
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
