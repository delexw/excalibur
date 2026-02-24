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

export class Orchestrator {
  constructor(options = {}) {
    this.logger = options.logger || null;
    this.prompts = options.prompts || {};
    this.consensus = options.consensus || {};
    this.owner = options.owner || {};
    this.consensusMode = options.consensusMode || "super";
    this.maxRounds = options.maxRounds || 5;
    this.processManager = options.processManager || null;
    this.agents = options.agents || [];
    this.responseValidator = new ResponseValidator({ 
      logger: this.logger, 
      agents: this.agents,
      threshold: this.consensus?.responseThreshold 
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
    });
  }

  async run(userQuestion, paint) {
    global.orchestrationInterrupted = false;

    const orchestrator = {
      id: "orchestrator",
      displayName: "Orchestrator",
      avatar: "⚔️",
    };

    this.logger.blockTitle(`Session ${this.logger.session} — ${this.agents.length} agents`);
    this.logger.line(orchestrator, "phase", `Session start - ${this.agents.length} agents`);

    if (!this.logger.quiet) {
      this.logger.line(paint(`Owners: ${this.owner.ids.length ? this.owner.ids.join(", ") : "none"} | ownerMin=${this.owner.minScore} | ownerMode=${this.owner.mode}\n`, "gray"));
      this.logger.line(paint(`Consensus=${this.consensusMode} | thresholds: U=${this.consensus.unanimousPct} S=${this.consensus.superMajorityPct} M=${this.consensus.majorityPct} | blockers=${this.consensus.requireNoBlockers ? "strict" : "allowed"} | rubberPenalty=${this.consensus.rubberPenalty}\n`, "gray"));
    }

    this.logger.line(orchestrator, "question", userQuestion);
    this.logger.blockTitle("Initial Proposals ......");
    this.logger.line(orchestrator, "phase", "Round 0 - Initial proposals");

    for (const agent of this.agents) {
      this.logger.line(agent, "", "Crafting my solution approach...");
    }

    const r0 = await this.proposalPhase.run(userQuestion);

    if (this.agentSpawner.checkInterruption(true)) return;

    if (r0.failed) {
      process.exit(1);
    }

    let proposals = r0.results.map((p) => ({ agentId: p.agentId, payload: p.res.json }));

    return await this.roundIterator.iterate(userQuestion, proposals);
  }
}
