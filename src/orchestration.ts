/**
 * Orchestrator - Multi-agent debate and consensus logic
 *
 * Handles proposal → critique → revision → vote cycles until consensus is reached.
 */

import { AgentSpawner } from "./orchestration/agent-spawner.js";
import { ResponseValidator } from "./orchestration/response-validator.js";
import { PromptBuilder } from "./orchestration/prompt-builder.js";
import { ProposalPhase } from "./orchestration/phase-handler.js";
import { RoundIterator } from "./orchestration/round-iterator.js";
import { DEFAULT_SYS_PROMPTS } from "./types.js";
import type { Agent, OrchestratorOptions, ConversationLogger, ProcessManager, ConsensusConfig, OwnerConfig, PromptBuilder as PromptBuilderType, ResponseValidator as ResponseValidatorType, AgentSpawner as AgentSpawnerType, Orchestrator as OrchestratorType, ProposalPayload, OrchestrationResult, SysPrompts } from "./types.js";

export class Orchestrator {
  logger: ConversationLogger | null;
  prompts: SysPrompts;
  consensus: ConsensusConfig;
  owner: OwnerConfig;
  consensusMode: string;
  maxRounds: number;
  processManager: ProcessManager | null;
  agents: Agent[];
  orchestrator: OrchestratorType;
  responseValidator: ResponseValidatorType;
  agentSpawner: AgentSpawnerType;
  promptBuilder: PromptBuilderType;
  proposalPhase: ProposalPhase;
  roundIterator: RoundIterator;

  constructor(options: OrchestratorOptions = {}) {
    this.logger = options.logger || null;
    this.prompts = options.prompts || DEFAULT_SYS_PROMPTS;
    this.consensus = options.consensus || { unanimousPct: 0.75, superMajorityPct: 0.75, majorityPct: 0.5, requireNoBlockers: true, rubberPenalty: 0.5, responseThreshold: 0.8 };
    this.owner = options.owner || { ids: [], minScore: 0.8, mode: 'any' };
    this.consensusMode = options.consensusMode || "super";
    this.maxRounds = options.maxRounds || 5;
    this.processManager = options.processManager || null;
    this.agents = options.agents || [];
    this.orchestrator = options.orchestrator || { id: "orchestrator", displayName: "Orchestrator", avatar: "🗂️" };
    this.responseValidator = new ResponseValidator({
      logger: this.logger,
      agents: this.agents,
      threshold: this.consensus?.responseThreshold,
      orchestrator: this.orchestrator,
    });
    this.agentSpawner = new AgentSpawner({ logger: this.logger, processManager: this.processManager });
    this.promptBuilder = new PromptBuilder({ agents: this.agents });
    this.proposalPhase = new ProposalPhase({
      prompts: this.prompts,
      agents: this.agents,
      promptBuilder: this.promptBuilder,
      agentSpawner: this.agentSpawner,
      responseValidator: this.responseValidator,
    });
    this.roundIterator = new RoundIterator({
      maxRounds: this.maxRounds,
      logger: this.logger,
      agents: this.agents,
      prompts: this.prompts,
      promptBuilder: this.promptBuilder,
      agentSpawner: this.agentSpawner,
      responseValidator: this.responseValidator,
      consensus: this.consensus,
      consensusMode: this.consensusMode,
      owner: this.owner,
      orchestrator: this.orchestrator,
    });
  }

  async run(userQuestion: string, paint?: (txt: string, colour: string) => string): Promise<OrchestrationResult> {
    global.orchestrationInterrupted = false;

    const orchestrator = this.orchestrator;

    this.logger?.blockTitle(`Session ${this.logger.session} — ${this.agents.length} agents`);
    this.logger?.line(orchestrator, "phase", `Session start - ${this.agents.length} agents`);

    if (!this.logger?.quiet) {
      this.logger?.line(orchestrator, "", paint?.(`Owners: ${this.owner.ids.length ? this.owner.ids.join(", ") : "none"} | ownerMin=${this.owner.minScore} | ownerMode=${this.owner.mode}\n`, "gray") || "");
      this.logger?.line(orchestrator, "", paint?.(`Consensus=${this.consensusMode} | thresholds: U=${this.consensus.unanimousPct} S=${this.consensus.superMajorityPct} M=${this.consensus.majorityPct} | blockers=${this.consensus.requireNoBlockers ? "strict" : "allowed"} | rubberPenalty=${this.consensus.rubberPenalty}\n`, "gray") || "");
    }

    this.logger?.line(orchestrator, "question", userQuestion);
    this.logger?.blockTitle("Initial Proposals ......");
    this.logger?.line(orchestrator, "phase", "Round 0 - Initial proposals");

    for (const agent of this.agents) {
      this.logger?.line(agent, "", "Crafting my solution approach...");
    }

    const r0 = await this.proposalPhase.run(userQuestion);

    if (this.agentSpawner.checkInterruption(true)) return;

    if (r0.failed) {
      process.exit(1);
    }

    let proposals = r0.results.map((p) => ({ agentId: p.agentId, payload: p.res.json as ProposalPayload }));

    return await this.roundIterator.iterate(userQuestion, proposals);
  }
}
