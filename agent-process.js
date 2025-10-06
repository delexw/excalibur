/**
 * Agent Process Spawner
 *
 * Shared utility for spawning agent CLI processes with clean stdout/stderr pipes.
 * Follows SOLID principles - Single Responsibility for process management.
 */

import { spawn } from 'node:child_process';

/**
 * Spawn agent process and collect output
 *
 * @param {Object} agent - Agent configuration with cmd, args, timeoutMs
 * @param {string} prompt - Prompt to send to agent (replaces {PROMPT} in args)
 * @param {Object} options - Spawn options
 * @param {number} options.timeout - Timeout in milliseconds (default: agent.timeoutMs or 120000)
 * @param {Function} options.onStdout - Optional callback for stdout data chunks
 * @param {Function} options.onStderr - Optional callback for stderr data chunks
 * @param {Set|Map} options.processTracker - Optional Set or Map to track active processes
 * @returns {Promise<{ok: boolean, output: string, error: string}>}
 */
export async function spawnAgentProcess(agent, prompt, options = {}) {
  const {
    timeout = agent.timeoutMs || 120000,
    onStdout = null,
    onStderr = null,
    processTracker = null
  } = options;

  const args = agent.args.map(a => a.replace('{PROMPT}', prompt));

  return new Promise((resolve, reject) => {
    const proc = spawn(agent.cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Track in Set or Map if provided (supports both for flexibility)
    if (processTracker) {
      if (processTracker instanceof Map) {
        processTracker.set(agent.id, proc);
      } else {
        processTracker.add(proc);
      }
    }

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

    const cleanup = (code) => {
      if (processTracker) {
        if (processTracker instanceof Map) {
          processTracker.delete(agent.id);
        } else {
          processTracker.delete(proc);
        }
      }
      clearTimeout(timeoutId);
    };

    proc.on('close', (code) => {
      cleanup(code);
      resolve({ ok: code === 0, output: stdout, error: stderr });
    });

    proc.on('error', (err) => {
      cleanup();
      reject(err);
    });

    // Handle timeout
    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      cleanup();
      reject(new Error(`Process killed by timeout after ${timeout}ms`));
    }, timeout);
  });
}
