import { VoteTallier } from "./vote-tallier.js";
import { OwnerApprovalHandler } from "./owner-approval-handler.js";
import { ResponseFormatter } from "./response-formatter.js";
import { ActionHandler } from "./action-handler.js";

export class ConsensusHandler {
  constructor(options = {}) {
    this.logger = options.logger || null;
    this.agents = options.agents || [];
    this.consensus = options.consensus || {};
    this.consensusMode = options.consensusMode || "super";
    this.maxRounds = options.maxRounds || 5;
    this.prompts = options.prompts || {};
    this.agentSpawner = options.agentSpawner || null;
    this.owner = options.owner || {};
    this.voteTallier = new VoteTallier();
    this.responseFormatter = new ResponseFormatter({ logger: this.logger });
    this.ownerApprovalHandler = new OwnerApprovalHandler({ logger: this.logger, owner: this.owner });
    this.actionHandler = new ActionHandler({
      logger: this.logger,
      agents: this.agents,
      prompts: this.prompts,
      agentSpawner: this.agentSpawner,
      responseFormatter: this.responseFormatter,
    });
  }

  async checkConsensus(roundResult, proposals, orchestrator) {
    const { votes, crits } = roundResult;

    const okVotes = votes.filter((v) => v.res && v.res.ok);
    if (okVotes.length === 0) {
      this.logger.blockTitle("No votes received, continuing...");
      return { consensusReached: false };
    }

    const tallies = this.voteTallier.calculateTallies(proposals, okVotes);

    const threshold = this.consensusMode === "unanimous" ? this.consensus.unanimousPct : this.consensusMode === "super" ? this.consensus.superMajorityPct : this.consensus.majorityPct;

    const maxScore = Math.max(...Array.from(tallies.values()).map((t) => t.score));
    const normalizedMaxScore = maxScore / okVotes.length;

    this.logger.blockTitle(`Consensus check: ${normalizedMaxScore.toFixed(2)} vs threshold ${threshold}`);
    this.logger.line(orchestrator, "vote", `Consensus check: ${normalizedMaxScore.toFixed(2)} vs threshold ${threshold}`);

    if (normalizedMaxScore >= threshold) {
      const winnerId = Array.from(tallies.entries()).find(([id, tally]) => tally.score === maxScore)?.[0];
      const winner = proposals.find((p) => p.agentId === winnerId);

      return { consensusReached: true, winner, winnerId, score: normalizedMaxScore, votes: okVotes };
    }

    return { consensusReached: false };
  }

  async handleConsensusReached(winner, winnerId, score, orchestrator, okVotes) {
    const approvalResult = this.ownerApprovalHandler.checkApproval(winnerId, okVotes);
    this.ownerApprovalHandler.logApproval(approvalResult, this.agents, winnerId);

    if (!approvalResult.approved) {
      return { consensusReached: false };
    }

    this.logger.blockTitle(`✅ Consensus reached! Winner: ${winnerId}`);
    this.logger.line(orchestrator, "consensus", `Consensus reached with ${winnerId} - score: ${score.toFixed(2)}`);

    const winningPayload = winner.payload.revised || winner.payload;

    const actionResult = await this.actionHandler.checkAgreement(winningPayload, winnerId, orchestrator);

    if (actionResult.shouldExecute) {
      const winnerAgent = this.agents.find(a => a.id === winnerId);
      this.logger.line(winnerAgent, "", "Executing approved action...");
      const executionResult = await this.actionHandler.execute(actionResult, winningPayload, orchestrator);
      return this.responseFormatter.formatActionResponse(actionResult, winningPayload, executionResult, orchestrator);
    }

    const finalAnswer = this.responseFormatter.formatFinalAnswer(winningPayload);
    return finalAnswer;
  }

  handleNoConsensus(proposals, orchestrator, lastRoundVotes) {
    this.logger.blockTitle("❌ No consensus reached after maximum rounds");
    this.logger.line(orchestrator, "consensus", `No consensus reached after ${this.maxRounds} rounds`);

    const okVotes = lastRoundVotes.filter((v) => v.res && v.res.ok);
    let winner, winnerId;

    if (okVotes.length > 0) {
      const tallies = this.voteTallier.calculateTallies(proposals, okVotes);
      const maxScore = Math.max(...Array.from(tallies.values()).map((t) => t.score));
      winnerId = Array.from(tallies.entries()).find(([id, tally]) => tally.score === maxScore)?.[0];
      winner = proposals.find((p) => p.agentId === winnerId);
    } else {
      winnerId = proposals[0]?.agentId;
      winner = proposals[0];
    }

    const winningPayload = winner?.payload?.revised || winner?.payload;
    const finalAnswer = this.responseFormatter.formatFinalAnswer(winningPayload);

    this.logger.blockTitle("===== BEST CANDIDATE =====");
    this.logger.line(orchestrator, "result", `Best proposal from ${winnerId}:\n${finalAnswer}`);
    this.logger.blockTitle("==========================");

    return finalAnswer;
  }
}
