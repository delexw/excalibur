import type { OwnerApprovalHandlerOptions, ConversationLogger, OwnerConfig, Vote, ApprovalResult, Agent, Orchestrator, VotePayload } from '../types.js';

export class OwnerApprovalHandler {
  logger: ConversationLogger | null;
  owner: OwnerConfig;

  constructor(options: OwnerApprovalHandlerOptions = {}) {
    this.logger = options.logger || null;
    this.owner = options.owner || { ids: [], minScore: 0.8, mode: 'any' };
  }

  checkApproval(winnerId: string, votes: Vote[]): ApprovalResult {
    if (this.owner.ids.length === 0) {
      return { approved: true, ownerScores: new Map() };
    }

    const ownerScores = new Map();
    for (const vote of votes) {
      const voterId = vote.agentId;
      if (this.owner.ids.includes(voterId)) {
        const voteJson = vote.res.json as VotePayload;
        const scores = voteJson.scores || [];
        const ownerVote = scores.find((s) => s.agent_id === winnerId);
        if (ownerVote) {
          ownerScores.set(voterId, ownerVote.score);
        }
      }
    }

    const ownersAboveMin = Array.from(ownerScores.entries())
      .filter(([_, score]) => score >= this.owner.minScore)
      .map(([id]) => id);

    let approved = false;
    if (this.owner.mode === "all") {
      approved = this.owner.ids.every((ownerId) => ownersAboveMin.includes(ownerId));
    } else {
      approved = ownersAboveMin.length > 0;
    }

    return { approved, ownerScores, ownersAboveMin };
  }

  logApproval(approvalResult: ApprovalResult, agents: Agent[], winnerId: string, orchestrator: Agent | Orchestrator): void {
    const { approved, ownerScores, ownersAboveMin } = approvalResult;
    const winnerAgent = agents.find((a) => a.id === winnerId);
    const winnerName = winnerAgent?.displayName || winnerId;

    if (!approved) {
      this.logger.blockTitle(`⚠️ Owner approval required but not met (mode=${this.owner.mode}, minScore=${this.owner.minScore})`);
      this.logger.line(orchestrator, "owner", `Owner approval not met - mode=${this.owner.mode}, minScore=${this.owner.minScore}`);
      for (const ownerId of this.owner.ids) {
        const score = ownerScores.get(ownerId);
        const agent = agents.find((a) => a.id === ownerId);
        if (!agent) continue;
        if (score !== undefined) {
          if (score >= this.owner.minScore) {
            this.logger.line(agent, "owner-approve", `I approve ${winnerName}'s proposal for consensus.`);
          } else {
            this.logger.line(agent, "owner-reject", `I reject ${winnerName}'s proposal for consensus.`);
          }
        } else {
          this.logger.line(agent, "owner-reject", `I reject ${winnerName}'s proposal for consensus. I did not vote.`);
        }
      }
    } else if (this.owner.ids.length > 0) {
      this.logger.blockTitle(`✓ Owner approval granted`);
      this.logger.line(orchestrator, "owner", `Owner approval granted - owners: ${ownersAboveMin.join(", ")}`);
    }
  }
}
