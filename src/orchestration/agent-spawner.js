import { spawn } from 'node:child_process';
import { ProcessManager } from '../process-manager.js';
import { getParserForAgent } from '../parsers/index.js';

export class AgentSpawner {
  constructor(options = {}) {
    this.logger = options.logger || null;
    this.processManager = options.processManager || null;
    this.maxRetries = options.maxRetries || 3;
    this.baseDelay = options.baseDelay || 1000;
  }

  async spawn(agent, prompt, timeoutSec, phase = "response") {
    let lastResult;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      if (this.checkInterruption()) return this.checkInterruption();

      const result = await this.spawnOnce(agent, prompt, timeoutSec, phase);
      lastResult = result;

      if (result.ok) {
        if (attempt > 1 && this.logger) {
          this.logger.line(agent, "retry:success", `Succeeded on attempt ${attempt}/${this.maxRetries}`, true);
        }
        return result;
      }

      if (result.error?.includes("Failed to spawn")) {
        return result;
      }

      if (attempt < this.maxRetries) {
        const delay = this.baseDelay * attempt;
        if (this.logger) {
          this.logger.line(agent, "retry", `Attempt ${attempt}/${this.maxRetries} failed. Retrying in ${delay}ms...`, true);
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return lastResult;
  }

  checkInterruption(returnBoolean = false) {
    if (global.orchestrationInterrupted) {
      if (returnBoolean) return true;
      return { ok: false, error: "Interrupted by user", interrupted: true };
    }
    return returnBoolean ? false : null;
  }

  async spawnOnce(agent, prompt, timeoutSec, phase = "response") {
    const interrupted = this.checkInterruption();
    if (interrupted) return interrupted;

    if (this.logger?.blessedUI?.setAgentStatus) {
      this.logger.blessedUI.setAgentStatus(agent.id, "running");
    }

    const timeout = Math.max(agent.timeoutMs || timeoutSec * 1000, timeoutSec * 1000);

    let result;
    try {
      result = await spawnAgentProcess(agent, prompt, { timeout, processManager: this.processManager });
    } catch (err) {
      if (this.logger?.blessedUI?.setAgentStatus) {
        this.logger.blessedUI.setAgentStatus(agent.id, "failed");
      }
      if (this.logger) {
        this.logger.line(agent, "error", `Agent failed: ${err.message}`, true);
      }
      return { ok: false, error: err.message, raw: "" };
    }

    const parser = getParserForAgent(agent);

    try {
      if (this.logger) {
        this.logger.line(agent, "response:raw", result.output, true);
      }
      const normalizedJsonText = parser.parse(result.output);
      const json = JSON.parse(normalizedJsonText);
      if (this.logger) {
        this.logger.line(agent, "response:normalized", JSON.stringify(json, null, 2), true);
        this.logAgentResponse(agent, json, phase);
      }

      if (this.logger?.blessedUI?.setAgentStatus) {
        this.logger.blessedUI.setAgentStatus(agent.id, "completed");
      }

      return { ok: true, json, raw: result.output };
    } catch (parseErr) {
      if (this.logger?.blessedUI?.setAgentStatus) {
        this.logger.blessedUI.setAgentStatus(agent.id, "failed");
      }
      return { ok: false, error: `Parse error from ${agent.id}: ${parseErr.message}`, raw: result.output };
    }
  }

  logAgentResponse(agent, json, phase) {
    switch (phase) {
      case "proposal":
      case "propose":
        this.logger.line(agent, "proposal", `My proposal: ${json.proposal || "No proposal provided"}`);
        break;
      case "critique":
        for (const c of json.critiques || []) {
          if (c.conversation_message) this.logger.line(agent, "critique", c.conversation_message);
        }
        if (!json.critiques?.length) {
          this.logger.line(agent, "critique", "The current proposals look solid to me.");
        }
        break;
      case "revision":
      case "revise":
        for (const r of json.response_to_feedback || []) {
          if (r.conversation_message) this.logger.line(agent, "revision", r.conversation_message);
        }
        break;
      case "vote":
        if (json.conversation_message) {
          this.logger.line(agent, "vote", json.conversation_message);
        } else {
          this.logger.line(agent, "error", "Missing conversation_message for vote response");
        }
        break;
      case "action-agree":
        const actionAgree = json.action_description || "";
        const agreed = json.agreed ? "agreed" : "disagreed";
        const reason = json.reason || "";
        this.logger.line(agent, "action-agree", `[${agreed.toUpperCase()}] ${actionAgree} ${reason ? `- ${reason}` : ''}`);
        break;
      case "execute":
        this.logger.line(agent, "execute", json.proposal || json.message || "Action executed");
        break;
    }
  }
}

export async function spawnAgentProcess(agent, prompt, options = {}) {
  const {
    timeout = agent.timeoutMs || 120000,
    onStdout = null,
    onStderr = null,
    processManager = null
  } = options;

  const args = agent.args.map(a => a.replace('{PROMPT}', prompt));

  return new Promise((resolve, reject) => {
    const proc = spawn(agent.cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    if (processManager instanceof ProcessManager) {
      processManager.add(agent.id, proc);
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

    let settled = false;
    let timedOut = false;
    const settle = (fn, val) => {
      if (!settled) {
        settled = true;
        fn(val);
      }
    };

    const cleanup = () => {
      if (processManager instanceof ProcessManager) {
        processManager.delete(agent.id);
      }
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
