import { CritiquePhase, RevisionPhase, VotePhase } from "./phase-handler.js";
import { ConsensusHandler } from "./consensus-handler.js";

export class RoundIterator {
  constructor(options = {}) {
    this.maxRounds = options.maxRounds || 5;
    this.logger = options.logger || null;
    this.agents = options.agents || [];
    this.prompts = options.prompts || {};
    this.promptBuilder = options.promptBuilder || null;
    this.agentSpawner = options.agentSpawner || null;
    this.responseValidator = options.responseValidator || null;
    this.consensus = options.consensus || {};
    this.consensusMode = options.consensusMode || "super";
    this.owner = options.owner || {};
    this.orchestrator = options.orchestrator || {};

    this.critiquePhase = new CritiquePhase({
      prompts: this.prompts,
      agents: this.agents,
      promptBuilder: this.promptBuilder,
      agentSpawner: this.agentSpawner,
      responseValidator: this.responseValidator,
    });
    this.revisionPhase = new RevisionPhase({
      prompts: this.prompts,
      agents: this.agents,
      promptBuilder: this.promptBuilder,
      agentSpawner: this.agentSpawner,
      responseValidator: this.responseValidator,
    });
    this.votePhase = new VotePhase({
      prompts: this.prompts,
      agents: this.agents,
      promptBuilder: this.promptBuilder,
      agentSpawner: this.agentSpawner,
      responseValidator: this.responseValidator,
    });
    this.consensusHandler = new ConsensusHandler({
      logger: this.logger,
      agents: this.agents,
      consensus: this.consensus,
      consensusMode: this.consensusMode,
      maxRounds: this.maxRounds,
      prompts: this.prompts,
      agentSpawner: this.agentSpawner,
      owner: this.owner,
    });
  }

  async iterate(userQuestion, proposals) {
    const orchestrator = this.orchestrator;

    for (let round = 1; round <= this.maxRounds; round++) {
      const roundResult = await this.runCritiqueVoteRound(round, userQuestion, proposals);

      if (roundResult.interrupted) return;

      proposals = this.applyRevisions(proposals, roundResult.revisions);
      const consensusResult = await this.consensusHandler.checkConsensus(roundResult, proposals, orchestrator);

      if (consensusResult.consensusReached) {
        return await this.consensusHandler.handleConsensusReached(consensusResult.winner, consensusResult.winnerId, consensusResult.score, orchestrator, consensusResult.votes);
      }
    }

    return this.consensusHandler.handleNoConsensus(proposals, orchestrator, []);
  }

  async runCritiqueVoteRound(round, userQuestion, proposals) {
    this.logger.blockTitle(`Round ${round}: critiques & voting`);
    this.logger.line({ id: "orchestrator", avatar: "🗂️", displayName: "Orchestrator", color: "white" }, "phase", `Round ${round} - Critiques & voting`);

    for (const agent of this.agents) {
      this.logger.line(agent, "", "Reviewing peer proposals...");
    }

    const critsResult = await this.critiquePhase.run(userQuestion, proposals);
    if (this.agentSpawner.checkInterruption(true)) return { interrupted: true };

    if (critsResult.failed) {
      return { interrupted: true, crits: [], revisions: [], votes: [] };
    }

    for (const agent of this.agents) {
      this.logger.line(agent, "", "Revising my proposal based on feedback...");
    }

    const revisionsResult = await this.revisionPhase.run(userQuestion, proposals, critsResult.results);
    if (this.agentSpawner.checkInterruption(true)) return { interrupted: true };

    if (revisionsResult.failed) {
      return { interrupted: true, crits: [], revisions: [], votes: [] };
    }

    for (const agent of this.agents) {
      this.logger.line(agent, "", "Voting on proposals...");
    }

    const votesResult = await this.votePhase.run(userQuestion, proposals);

    if (votesResult.failed) {
      return { interrupted: true, crits: [], revisions: [], votes: [] };
    }

    return { interrupted: false, crits: critsResult.results, revisions: revisionsResult.results, votes: votesResult.results };
  }

  applyRevisions(proposals, revisions) {
    for (const rev of revisions) {
      if (rev.res?.ok) {
        const idx = proposals.findIndex((p) => p.agentId === rev.agentId);
        if (idx >= 0) {
          const originalPayload = proposals[idx].payload;
          const revisionPayload = rev.res.json;
          if (!revisionPayload.revised?.is_changed) {
            revisionPayload.revised.proposal = originalPayload.proposal || originalPayload.revised?.proposal || "No proposal";
          }
          proposals[idx].payload = revisionPayload;
        }
      }
    }
    return proposals;
  }
}
