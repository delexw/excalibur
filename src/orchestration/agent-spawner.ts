import { getParserForAgent } from '../parsers/index.js';
import type { AgentSpawnerOptions, Agent, ParseResult, ConversationLogger, ProcessManager, AgentResponsePayload, ProposalPayload, CritiqueEntry, FeedbackResponse, ActionAgreePayload, ActionExecutePayload, CritiquePayload, RevisionPayload, VotePayload } from '../types.js';

export class AgentSpawner {
  logger: ConversationLogger | null;
  processManager: ProcessManager | null;
  maxRetries: number;
  baseDelay: number;

  constructor(options: AgentSpawnerOptions = {}) {
    this.logger = options.logger || null;
    this.processManager = options.processManager || null;
    this.maxRetries = options.maxRetries || 3;
    this.baseDelay = options.baseDelay || 1000;
  }

  async spawn(agent: Agent, prompt: string, timeoutSec: number, phase: string = "response"): Promise<ParseResult> {
    let lastResult: ParseResult | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const interruption = this.checkInterruption();
      if (interruption) {
        if (interruption === true) continue;
        return interruption;
      }

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

  checkInterruption(returnBoolean = false): boolean | ParseResult | null {
    if (global.orchestrationInterrupted) {
      if (returnBoolean) return true;
      return { ok: false, error: "Interrupted by user", json: {} as AgentResponsePayload, raw: "" };
    }
    return returnBoolean ? false : null;
  }

  async spawnOnce(agent: Agent, prompt: string, timeoutSec: number, phase: string = "response"): Promise<ParseResult> {
    const interrupted = this.checkInterruption();
    if (interrupted && interrupted !== true) return interrupted;

    if (this.logger?.blessedUI?.setAgentStatus) {
      this.logger.blessedUI.setAgentStatus(agent.id, "running");
    }

    const timeout = Math.max(agent.timeoutMs || timeoutSec * 1000, timeoutSec * 1000);

    let result;
    try {
      result = await this.processManager.spawnProcess(agent, prompt, { timeout });
    } catch (err) {
      if (this.logger?.blessedUI?.setAgentStatus) {
        this.logger.blessedUI.setAgentStatus(agent.id, "failed");
      }
      if (this.logger) {
        this.logger.line(agent, "error", `Agent failed: ${err.message}`, true);
      }
      return { ok: false, error: err.message, json: {} as AgentResponsePayload, raw: "" };
    }

    const parser = getParserForAgent(agent);

    try {
      if (this.logger) {
        this.logger.line(agent, "response:raw", result.output, true);
      }
      const normalizedJsonText = parser.parse(result.output);
      const json = JSON.parse(normalizedJsonText) as AgentResponsePayload;
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
      return { ok: false, error: `Parse error from ${agent.id}: ${parseErr.message}`, json: {} as AgentResponsePayload, raw: result.output };
    }
  }

  logAgentResponse(agent: Agent, json: AgentResponsePayload, phase: string): void {
    switch (phase) {
      case "proposal":
      case "propose": {
        const payload = json as ProposalPayload;
        this.logger.line(agent, "proposal", `My proposal: ${payload.proposal || "No proposal provided"}`);
        break;
      }
      case "critique": {
        const payload = json as CritiquePayload;
        const critiques: CritiqueEntry[] = payload.critiques || [];
        for (const c of critiques) {
          if (c.conversation_message) this.logger.line(agent, "critique", c.conversation_message);
        }
        if (!critiques.length) {
          this.logger.line(agent, "critique", "The current proposals look solid to me.");
        }
        break;
      }
      case "revision":
      case "revise": {
        const payload = json as RevisionPayload;
        const feedback: FeedbackResponse[] = payload.response_to_feedback || [];
        for (const r of feedback) {
          if (r.conversation_message) this.logger.line(agent, "revision", r.conversation_message);
        }
        break;
      }
      case "vote": {
        const payload = json as VotePayload;
        const voteMsg = payload.conversation_message;
        if (voteMsg) {
          this.logger.line(agent, "vote", voteMsg);
        } else {
          this.logger.line(agent, "error", "Missing conversation_message for vote response");
        }
        break;
      }
      case "action-agree": {
        const payload = json as ActionAgreePayload;
        const actionAgree = payload.action_description || "";
        const agreed = payload.agreed ? "agreed" : "disagreed";
        const reason = payload.reason || "";
        this.logger.line(agent, "action-agree", `[${agreed.toUpperCase()}] ${actionAgree} ${reason ? `- ${reason}` : ''}`);
        break;
      }
      case "execute": {
        const payload = json as ActionExecutePayload;
        const execOutput = payload.output || "Action executed";
        this.logger.line(agent, "execute", execOutput);
        break;
      }
    }
  }
}
