import type { Proposal, Vote, Tally, VotePayload } from '../types.js';

export class VoteTallier {

  calculateTallies(proposals: Proposal[], votes: Vote[]): Map<string, Tally> {
    const tallies = new Map<string, Tally>();
    for (const agentId of proposals.map((p) => p.agentId)) {
      tallies.set(agentId, { score: 0, voters: [] });
    }
    for (const vote of votes) {
      const voteJson = vote.res.json as VotePayload;
      const scores = voteJson.scores || [];
      for (const scoreEntry of scores) {
        const targetId = scoreEntry.agent_id;
        const score = scoreEntry.score;
        if (tallies.has(targetId) && typeof score === "number") {
          const tally = tallies.get(targetId);
          if (tally) {
            tally.score += score;
            tally.voters.push(vote.agentId);
          }
        }
      }
    }
    return tallies;
  }
}
