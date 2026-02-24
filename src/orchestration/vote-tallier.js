export class VoteTallier {
  calculateTallies(proposals, votes) {
    const tallies = new Map();
    for (const agentId of proposals.map((p) => p.agentId)) {
      tallies.set(agentId, { score: 0, voters: [] });
    }
    for (const vote of votes) {
      for (const scoreEntry of vote.res.json.scores || []) {
        const targetId = scoreEntry.agent_id;
        const score = scoreEntry.score;
        if (tallies.has(targetId) && typeof score === "number") {
          const tally = tallies.get(targetId);
          tally.score += score;
          tally.voters.push(vote.agentId);
        }
      }
    }
    return tallies;
  }
}
