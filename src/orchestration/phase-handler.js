export class PhaseHandler {
  constructor(options = {}) {
    this.agents = options.agents || [];
    this.promptBuilder = options.promptBuilder || null;
    this.agentSpawner = options.agentSpawner || null;
    this.responseValidator = options.responseValidator || null;
    this.promptTemplate = options.promptTemplate || "";
    this.phaseName = options.phaseName || "unknown";
    this.roundName = options.roundName || "Unknown round";
  }

  async run(question, context = {}) {
    throw new Error("Not implemented");
  }
}

export class ProposalPhase extends PhaseHandler {
  constructor(options = {}) {
    super({
      ...options,
      promptTemplate: options.prompts?.propose || "",
      phaseName: "propose",
      roundName: "Round 0 (proposals)",
    });
  }

  async run(question, context = {}) {
    const prompt = this.promptBuilder.build(this.promptTemplate, question, context, this.agents);
    const results = await Promise.all(
      this.agents.map(async (a) => {
        const res = await this.agentSpawner.spawn(a, prompt, 300, this.phaseName);
        return { agentId: a.id, res };
      }),
    );

    const okResults = this.responseValidator.validate(results, this.roundName);
    if (!okResults) {
      return { failed: true, results };
    }
    return { failed: false, results: okResults };
  }
}

export class CritiquePhase extends PhaseHandler {
  constructor(options = {}) {
    super({
      ...options,
      promptTemplate: options.prompts?.critique || "",
      phaseName: "critique",
      roundName: "Critiques",
    });
  }

  async run(question, proposals) {
    const results = await Promise.all(
      this.agents.map(async (a) => {
        const otherProposals = proposals.filter(p => p.agentId !== a.id);
        const context = { current_proposals: otherProposals };
        const prompt = this.promptBuilder.build(this.promptTemplate, question, context, this.agents);
        const res = await this.agentSpawner.spawn(a, prompt, 300, this.phaseName);
        return { agentId: a.id, res };
      }),
    );

    const okResults = this.responseValidator.validate(results, this.roundName);
    if (!okResults) {
      return { failed: true, results };
    }
    return { failed: false, results: okResults };
  }
}

export class RevisionPhase extends PhaseHandler {
  constructor(options = {}) {
    super({
      ...options,
      promptTemplate: options.prompts?.revise || "",
      phaseName: "revise",
      roundName: "Revisions",
    });
  }

  async run(question, proposals, critiques) {
    const critiqueMap = new Map(critiques.map((c) => [c.agentId, c.res?.json?.critiques || []]));

    const results = await Promise.all(
      this.agents.map(async (a) => {
        const originalProposal = proposals.find((p) => p.agentId === a.id);
        if (!originalProposal) {
          return { agentId: a.id, res: { ok: false, error: "No proposal found for agent" } };
        }

        const receivedCritiques = [];
        for (const [criticId, critsForThisAgent] of critiqueMap) {
          const receivedCritiquesForThisAgent = critsForThisAgent.filter((c) => c.target_agent === a.id);
          for (const crit of receivedCritiquesForThisAgent) {
            receivedCritiques.push({ from_agent_id: criticId, points: crit.points || [] });
          }
        }

        const context = { your_proposal: originalProposal.payload, critiques_received: receivedCritiques };
        const prompt = this.promptBuilder.build(this.promptTemplate, question, context, this.agents);
        const res = await this.agentSpawner.spawn(a, prompt, 300, this.phaseName);
        return { agentId: a.id, res };
      }),
    );

    const okResults = this.responseValidator.validate(results, this.roundName);
    if (!okResults) {
      return { failed: true, results };
    }
    return { failed: false, results: okResults };
  }
}

export class VotePhase extends PhaseHandler {
  constructor(options = {}) {
    super({
      ...options,
      promptTemplate: options.prompts?.vote || "",
      phaseName: "vote",
      roundName: "Votes",
    });
  }

  async run(question, proposals) {
    const context = { current_proposals: proposals };
    const prompt = this.promptBuilder.build(this.promptTemplate, question, context, this.agents);
    const results = await Promise.all(
      this.agents.map(async (a) => {
        const res = await this.agentSpawner.spawn(a, prompt, 300, this.phaseName);
        return { agentId: a.id, res };
      }),
    );

    const okResults = this.responseValidator.validate(results, this.roundName);
    if (!okResults) {
      return { failed: true, results };
    }
    return { failed: false, results: okResults };
  }
}
