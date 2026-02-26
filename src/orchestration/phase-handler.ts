import type { PhaseHandlerOptions, Agent, PromptBuilder, AgentSpawner, ResponseValidator, RoundResult, Proposal, Critique, PromptContext, CritiquePayload, CritiqueEntry, CritiquePoint, AgentResponsePayload, ReceivedCritique } from '../types.js';

export class PhaseHandler {
  agents: Agent[];
  promptBuilder: PromptBuilder | null;
  agentSpawner: AgentSpawner | null;
  responseValidator: ResponseValidator | null;
  promptTemplate: string;
  phaseName: string;
  roundName: string;

  constructor(options: PhaseHandlerOptions = {}) {
    this.agents = options.agents || [];
    this.promptBuilder = options.promptBuilder || null;
    this.agentSpawner = options.agentSpawner || null;
    this.responseValidator = options.responseValidator || null;
    this.promptTemplate = options.promptTemplate || "";
    this.phaseName = options.phaseName || "unknown";
    this.roundName = options.roundName || "Unknown round";
  }

  async run(question: string, ..._args: (Proposal[] | Critique[] | PromptContext)[]): Promise<RoundResult> {
    throw new Error("Not implemented");
  }
}

export class ProposalPhase extends PhaseHandler {
  constructor(options: PhaseHandlerOptions = {}) {
    super({
      ...options,
      promptTemplate: options.prompts?.propose || "",
      phaseName: "propose",
      roundName: "Round 0 (proposals)",
    });
  }

  async run(question: string, context: PromptContext = {}): Promise<RoundResult> {
    const prompt = this.promptBuilder.build(this.promptTemplate, question, context, this.agents);
    const results = await Promise.all(
      this.agents.map(async (a: Agent) => {
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
  constructor(options: PhaseHandlerOptions = {}) {
    super({
      ...options,
      promptTemplate: options.prompts?.critique || "",
      phaseName: "critique",
      roundName: "Critiques",
    });
  }

  async run(question: string, proposals: Proposal[]): Promise<RoundResult> {
    const results = await Promise.all(
      this.agents.map(async (a) => {
        const otherProposals = proposals.filter(p => p.agentId !== a.id);
        const context: PromptContext = { current_proposals: otherProposals };
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
  constructor(options: PhaseHandlerOptions = {}) {
    super({
      ...options,
      promptTemplate: options.prompts?.revise || "",
      phaseName: "revise",
      roundName: "Revisions",
    });
  }

  async run(question: string, proposals: Proposal[], critiques: Critique[]): Promise<RoundResult> {
    const critiqueMap = new Map(critiques.map((c) => {
      const json = c.res?.json as CritiquePayload | undefined;
      const crits: CritiqueEntry[] = json?.critiques || [];
      return [c.agentId, crits] as const;
    }));

    const results = await Promise.all(
      this.agents.map(async (a) => {
        const originalProposal = proposals.find((p) => p.agentId === a.id);
        if (!originalProposal) {
          return { agentId: a.id, res: { ok: false, error: "No proposal found for agent", json: {} as AgentResponsePayload, raw: "" } };
        }

        const receivedCritiques: ReceivedCritique[] = [];
        for (const [criticId, critsForThisAgent] of critiqueMap) {
          const receivedCritiquesForThisAgent = critsForThisAgent.filter((c) => c.target_agent === a.id);
          for (const crit of receivedCritiquesForThisAgent) {
            receivedCritiques.push({ from_agent_id: criticId, points: crit.points || [] });
          }
        }

        const context: PromptContext = { your_proposal: originalProposal.payload, critiques_received: receivedCritiques };
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
  constructor(options: PhaseHandlerOptions = {}) {
    super({
      ...options,
      promptTemplate: options.prompts?.vote || "",
      phaseName: "vote",
      roundName: "Votes",
    });
  }

  async run(question: string, proposals: Proposal[]): Promise<RoundResult> {
    const context: PromptContext = { current_proposals: proposals };
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
