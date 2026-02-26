import type { Agent, Orchestrator, ResponseValidatorOptions, ConversationLogger, AgentPhaseResult } from '../types.js';

export class ResponseValidator {
  logger: ConversationLogger | null;
  agents: Agent[];
  threshold: number;
  orchestrator: Orchestrator;

  constructor(options: ResponseValidatorOptions = {}) {
    this.logger = options.logger || null;
    this.agents = options.agents || [];
    this.threshold = options.threshold ?? 0.8;
    this.orchestrator = options.orchestrator || { id: "orchestrator", displayName: "Orchestrator", avatar: "⚠️" };
  }

  validate(results: AgentPhaseResult[], roundName: string): AgentPhaseResult[] | null {
    const total = this.agents.length;
    const ok = results.filter((x) => x.res && x.res.ok);
    const failed = results.filter((x) => !x.res || !x.res.ok);

    if (ok.length === 0) {
      const failedIds = failed.map((x) => x.agentId).join(", ");
      console.error(`No responses received in ${roundName}. Failed agents: ${failedIds}. Aborting.`);
      return null;
    }

    const pct = ok.length / total;

    if (pct < this.threshold) {
      const failedIds = failed.map((x) => x.agentId).join(", ");
      if (this.logger) {
        this.logger.line(
          this.orchestrator,
          "warning",
          `Only ${ok.length}/${total} (${Math.round(pct * 100)}%) agents responded in ${roundName} - below ${Math.round(this.threshold * 100)}% threshold. Continuing anyway. Failed: ${failedIds}`
        );
      }
    }

    return ok;
  }
}
