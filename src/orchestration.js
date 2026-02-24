/**
 * Orchestrator - Multi-agent debate and consensus logic
 *
 * Handles proposal → critique → revision → vote cycles until consensus is reached.
 */

import { AgentSpawner } from "./orchestration/agent-spawner.js";
import { ResponseValidator } from "./orchestration/response-validator.js";

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

    const r0 = await this.roundPropose(userQuestion);

    if (this.checkInterruption(null, true)) return;

    if (r0.failed) {
      process.exit(1);
    }

    let current = r0.results.map((p) => ({ agentId: p.agentId, payload: p.res.json }));

    for (let round = 1; round <= this.maxRounds; round++) {
      const roundResult = await this.runCritiqueVoteRound(round, userQuestion, current);

      if (roundResult.interrupted) return;

      current = this.applyRevisions(current, roundResult.revisions);
      const consensusResult = await this.checkConsensus(roundResult, current, orchestrator);

      if (consensusResult.consensusReached) {
        return consensusResult.returnValue;
      }
    }

    return this.handleNoConsensus(current, orchestrator, []);
  }

  async roundPropose(question) {
    const prompt = this.buildPrompt(this.prompts.propose, question, {}, this.agents);
    const results = await Promise.all(
      this.agents.map(async (a) => {
        const res = await this.agentSpawner.spawn(a, prompt, 300, "propose");
        return { agentId: a.id, res };
      }),
    );

    const okResults = this.responseValidator.validate(results, "Round 0 (proposals)");
    if (!okResults) {
      return { failed: true, results };
    }
    return { failed: false, results: okResults };
  }

  async roundCritique(question, current) {
    const results = await Promise.all(
      this.agents.map(async (a) => {
        const otherProposals = current.filter(p => p.agentId !== a.id);
        const prompt = this.buildPrompt(this.prompts.critique, question, { current_proposals: otherProposals }, this.agents);
        const res = await this.agentSpawner.spawn(a, prompt, 300, "critique");
        return { agentId: a.id, res };
      }),
    );

    const okResults = this.responseValidator.validate(results, "Critiques");
    if (!okResults) {
      return { failed: true, results };
    }
    return { failed: false, results: okResults };
  }

  async roundRevise(question, current, critiques) {
    const critiqueMap = new Map(critiques.map((c) => [c.agentId, c.res?.json?.critiques || []]));

    const results = await Promise.all(
      this.agents.map(async (a) => {
        const originalProposal = current.find((p) => p.agentId === a.id);
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

        const prompt = this.buildPrompt(this.prompts.revise, question, { your_proposal: originalProposal.payload, critiques_received: receivedCritiques }, this.agents);
        const res = await this.agentSpawner.spawn(a, prompt, 300, "revise");
        return { agentId: a.id, res };
      }),
    );

    const okResults = this.responseValidator.validate(results, "Revisions");
    if (!okResults) {
      return { failed: true, results };
    }
    return { failed: false, results: okResults };
  }

  async roundVote(question, current) {
    const prompt = this.buildPrompt(this.prompts.vote, question, { current_proposals: current }, this.agents);
    const results = await Promise.all(
      this.agents.map(async (a) => {
        const res = await this.agentSpawner.spawn(a, prompt, 300, "vote");
        return { agentId: a.id, res };
      }),
    );

    const okResults = this.responseValidator.validate(results, "Votes");
    if (!okResults) {
      return { failed: true, results };
    }
    return { failed: false, results: okResults };
  }

  async runCritiqueVoteRound(round, userQuestion, current) {
    this.logger.blockTitle(`Round ${round}: critiques & voting`);
    this.logger.line({ id: "orchestrator", avatar: "🗂️", displayName: "Orchestrator", color: "white" }, "phase", `Round ${round} - Critiques & voting`);

    for (const agent of this.agents) {
      this.logger.line(agent, "", "Reviewing peer proposals...");
    }

    const critsResult = await this.roundCritique(userQuestion, current);
    if (this.checkInterruption(null, true)) return { interrupted: true };

    if (critsResult.failed) {
      return { interrupted: true, crits: [], revisions: [], votes: [] };
    }

    for (const agent of this.agents) {
      this.logger.line(agent, "", "Revising my proposal based on feedback...");
    }

    const revisionsResult = await this.roundRevise(userQuestion, current, critsResult.results);
    if (this.checkInterruption(null, true)) return { interrupted: true };

    if (revisionsResult.failed) {
      return { interrupted: true, crits: [], revisions: [], votes: [] };
    }

    for (const agent of this.agents) {
      this.logger.line(agent, "", "Voting on proposals...");
    }

    const votesResult = await this.roundVote(userQuestion, current);

    if (votesResult.failed) {
      return { interrupted: true, crits: [], revisions: [], votes: [] };
    }

    return { interrupted: false, crits: critsResult.results, revisions: revisionsResult.results, votes: votesResult.results };
  }

  checkInterruption(agent, returnBoolean = false) {
    return this.agentSpawner.checkInterruption(agent, returnBoolean);
  }

  buildPrompt(base, question, context = {}) {
    let prompt = base;
    if (prompt.includes("{{AGENTS}}")) {
      const agentList = JSON.stringify(this.agents.map((a) => ({ agent_id: a.id, agent_display_name: `>${a.displayName}` })), null, 2);
      prompt = prompt.replace("{{AGENTS}}", agentList);
    }
    prompt = prompt.replace(/\{\{QUESTION\}\}/g, question);
    prompt = prompt.replace(/\{\{CONTEXT\}\}/g, JSON.stringify(context, null, 2));
    return prompt;
  }

  calculateVoteTallies(currentProposals, votes) {
    const tallies = new Map();
    for (const agentId of currentProposals.map((p) => p.agentId)) {
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

  checkOwnerApproval(winnerId, votes) {
    if (this.owner.ids.length === 0) {
      return { approved: true, ownerScores: new Map() };
    }

    const ownerScores = new Map();
    for (const vote of votes) {
      const voterId = vote.agentId;
      if (this.owner.ids.includes(voterId)) {
        const scores = vote.res.json.scores || [];
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

  logOwnerApproval(approvalResult, agents, winnerId) {
    const { approved, ownerScores, ownersAboveMin } = approvalResult;
    const winnerAgent = agents.find((a) => a.id === winnerId);
    const winnerName = winnerAgent?.displayName || winnerId;

    if (!approved) {
      this.logger.blockTitle(`⚠️ Owner approval required but not met (mode=${this.owner.mode}, minScore=${this.owner.minScore})`);
      this.logger.line({ id: "orchestrator", avatar: "🗂️", displayName: "Orchestrator", color: "white" }, "owner", `Owner approval not met - mode=${this.owner.mode}, minScore=${this.owner.minScore}`);
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
      this.logger.line({ id: "orchestrator", avatar: "🗂️", displayName: "Orchestrator", color: "white" }, "owner", `Owner approval granted - owners: ${ownersAboveMin.join(", ")}`);
    }
  }

  applyRevisions(current, revisions) {
    for (const rev of revisions) {
      if (rev.res?.ok) {
        const idx = current.findIndex((p) => p.agentId === rev.agentId);
        if (idx >= 0) {
          const originalPayload = current[idx].payload;
          const revisionPayload = rev.res.json;
          if (revisionPayload.revised?.proposal === "no change") {
            revisionPayload.revised.proposal = originalPayload.proposal || originalPayload.revised?.proposal || "No proposal";
          }
          current[idx].payload = revisionPayload;
        }
      }
    }
    return current;
  }

  async checkConsensus(roundResult, current, orchestrator) {
    const { votes, crits } = roundResult;

    // TODO: Implement requireNoBlockers
    // const hasBlockers = crits?.some(c => c.res?.json?.critiques?.some(crit => crit.points?.some(p => p.severity === 'blocker')));
    // if (this.consensus.requireNoBlockers && hasBlockers) { return { consensusReached: false }; }

    const okVotes = votes.filter((v) => v.res && v.res.ok);
    if (okVotes.length === 0) {
      this.logger.blockTitle("No votes received, continuing...");
      return { consensusReached: false };
    }

    const tallies = this.calculateVoteTallies(current, okVotes);

    // TODO: Implement rubber-stamp penalty
    // const rubberStampAgents = this.agents.filter(a => !crits.some(c => c.agentId === a.id && c.res?.ok));
    // Apply this.consensus.rubberPenalty to reduce their vote weight

    const threshold = this.consensusMode === "unanimous" ? this.consensus.unanimousPct : this.consensusMode === "super" ? this.consensus.superMajorityPct : this.consensus.majorityPct;

    const maxScore = Math.max(...Array.from(tallies.values()).map((t) => t.score));
    const normalizedMaxScore = maxScore / okVotes.length;

    this.logger.blockTitle(`Consensus check: ${normalizedMaxScore.toFixed(2)} vs threshold ${threshold}`);
    this.logger.line(orchestrator, "vote", `Consensus check: ${normalizedMaxScore.toFixed(2)} vs threshold ${threshold}`);

    if (normalizedMaxScore >= threshold) {
      const winnerId = Array.from(tallies.entries()).find(([id, tally]) => tally.score === maxScore)?.[0];
      const winner = current.find((p) => p.agentId === winnerId);

      return await this.handleConsensusReached(winner, winnerId, normalizedMaxScore, orchestrator, okVotes);
    }

    return { consensusReached: false };
  }

  async handleConsensusReached(winner, winnerId, score, orchestrator, okVotes) {
    const approvalResult = this.checkOwnerApproval(winnerId, okVotes);
    this.logOwnerApproval(approvalResult, this.agents, winnerId);

    if (!approvalResult.approved) {
      return { consensusReached: false };
    }

    this.logger.blockTitle(`✅ Consensus reached! Winner: ${winnerId}`);
    this.logger.line(orchestrator, "consensus", `Consensus reached with ${winnerId} - score: ${score.toFixed(2)}`);

    const winningPayload = winner.payload.revised || winner.payload;

    const actionResult = await this.checkActionAgreement(winningPayload, winnerId, this.agents, orchestrator);

    if (actionResult.shouldExecute) {
      const winnerAgent = this.agents.find(a => a.id === winnerId);
      this.logger.line(winnerAgent, "", "Executing approved action...");
      const executionResult = await this.executeAction(actionResult, winningPayload, this.agents, orchestrator);
      return { consensusReached: true, returnValue: this.formatActionResponse(actionResult, winningPayload, executionResult, orchestrator) };
    }

    const finalAnswer = this.formatFinalAnswer(winningPayload);
    return { consensusReached: true, returnValue: finalAnswer };
  }

  async checkActionAgreement(winningPayload, winnerId, agents, orchestrator) {
    const hasCodePatch = winningPayload.code_patch && winningPayload.code_patch.trim().length > 0;
    const hasTests = winningPayload.tests && winningPayload.tests.length > 0;

    if (!hasCodePatch && !hasTests) {
      this.logger.blockTitle("ℹ️ Proposal is informational only - no action needed");
      this.logger.line(orchestrator, "action", "The winning proposal contains no code or commands to execute");
      return { shouldExecute: false, actionable: false };
    }

    const winnerAgent = agents.find(a => a.id === winnerId);
    const winnerName = winnerAgent?.displayName || winnerId;

    const prompt = this.prompts.actionAgree
      .replace(/\{\{WINNER_AGENT\}\}/g, winnerName)
      .replace(/\{\{FINAL_ANSWER\}\}/g, this.formatFinalAnswer(winningPayload));

    const otherAgents = agents.filter(a => a.id !== winnerId);

    this.logger.blockTitle("🔧 Action Agreement Check");
    this.logger.line(orchestrator, "action", `Winning agent: ${winnerName} | Code patch: ${hasCodePatch ? 'yes' : 'no'} | Commands: ${hasTests ? 'yes' : 'no'}`);

    for (const a of otherAgents) {
      this.logger.line(a, "", "Evaluating if action should proceed...");
    }

    const results = await Promise.all(
      otherAgents.map(async (a) => {
        const res = await this.agentSpawner.spawn(a, `${prompt}\n\nReturn JSON only.`, 120, "action-agree");
        return { agentId: a.id, res };
      }),
    );

    const okResults = results.filter(r => r.res && r.res.ok);
    let agreedCount = 0;
    let disagreedAgents = [];

    for (const result of okResults) {
      try {
        const json = result.res.json;
        if (json.agreed) {
          agreedCount++;
        } else {
          disagreedAgents.push({ id: result.agentId, reason: json.reason });
        }
      } catch (e) {
        disagreedAgents.push({ id: result.agentId, reason: "Failed to parse response" });
      }
    }

    const totalVoters = okResults.length;
    const agreementRate = totalVoters > 0 ? agreedCount / totalVoters : 0;

    this.logger.line(orchestrator, "action", `Agreement: ${agreedCount}/${totalVoters} (${(agreementRate * 100).toFixed(0)}%)`);

    if (disagreedAgents.length > 0) {
      for (const d of disagreedAgents) {
        this.logger.line(orchestrator, "action", `${d.id} disagreed: ${d.reason}`);
      }
    }

    const shouldExecute = agreementRate >= 0.5;

    if (shouldExecute) {
      this.logger.line(orchestrator, "action", "✅ Action approved by majority");
      this.logger.line(orchestrator, "action", `Proceeding to execute action proposed by ${winnerName}`);
    } else {
      this.logger.line(orchestrator, "action", "⚠️ Action rejected by majority");
      this.logger.line(orchestrator, "action", `Action will not be executed - ${agreedCount}/${totalVoters} agreed`);
    }

    return { shouldExecute, actionable: true, winnerId, winnerAgent, agreementRate, agreedCount, totalVoters, payload: winningPayload };
  }

  async executeAction(actionResult, winningPayload, agents, orchestrator) {
    const winnerAgent = actionResult.winnerAgent;

    this.logger.line(orchestrator, "action", '🚀 Executing approved action...\n');

    const agent = agents.find(a => a.id === winnerAgent.id);
    if (!agent) {
      this.logger.line(orchestrator, "action", `❌ Agent ${winnerAgent.id} not found`);
      return;
    }

    let prompt = '';
    if (winningPayload.proposal) {
      prompt += winningPayload.proposal + '\n\n';
    }
    if (winningPayload.code_patch) {
      prompt += '```\n' + winningPayload.code_patch + '\n```\n\n';
    }
    if (winningPayload.tests && winningPayload.tests.length > 0) {
      prompt += 'Tests to run:\n' + winningPayload.tests.join('\n') + '\n\n';
    }

    const cwd = process.cwd();
    prompt += `
Working directory: ${cwd}

Execute the above commands/tests and return JSON with this schema:
{
  "executed": true|false,
  "output": "<what was executed and results>",
  "error": "<any errors encountered, or null if none>",
  "files_created": ["list of files created if any"],
  "files_modified": ["list of files modified if any"]
}

Return JSON only.`;

    this.logger.line(orchestrator, "action", `Executing agent: ${agent.id} (${agent.displayName})...\n`);
    const result = await this.agentSpawner.spawn(agent, prompt, 300, "execute");

    if (result.ok) {
      this.logger.line(orchestrator, "action", '✅ Action executed successfully');
    } else {
      this.logger.line(orchestrator, "action", `❌ Action execution failed: ${result.error || 'unknown error'}`);
    }

    return result;
  }

  formatActionResponse(actionResult, winningPayload, executionResult, orchestrator) {
    const winnerAgent = actionResult.winnerAgent;
    const response = {
      status: "action_approved",
      winner: { agent_id: actionResult.winnerId, display_name: winnerAgent?.displayName || actionResult.winnerId, avatar: winnerAgent?.avatar },
      agreement: { agreed: actionResult.agreedCount, total: actionResult.totalVoters, rate: actionResult.agreementRate },
      proposal: winningPayload.proposal,
      action: { type: "execute_agent", agent: { id: winnerAgent?.id, cmd: winnerAgent?.cmd, args: winnerAgent?.args }, code_patch: winningPayload.code_patch || null, tests: winningPayload.tests || [] },
      execution: { ok: executionResult?.ok || false, output: executionResult?.json || null, error: executionResult?.error || null },
    };

    this.logger.blockTitle("🚀 Returning Action Response");
    this.logger.line(orchestrator, "action", JSON.stringify(response, null, 2));

    return response.execution.output?.output || "No output from action execution";
  }

  formatFinalAnswer(payload) {
    if (!payload) return "No consensus reached";
    const sections = [];
    sections.push(payload.proposal || "(no proposal)");
    if (payload.code_patch) {
      sections.push("", "--- code_patch (unified diff) ---", payload.code_patch);
    }
    if (payload.tests && payload.tests.length) {
      sections.push("", "Tests to run:");
      payload.tests.forEach((test) => sections.push(`- ${test}`));
    }
    if (payload.key_points && payload.key_points.length) {
      sections.push("", "Key points:");
      payload.key_points.forEach((point) => sections.push(`- ${point}`));
    }
    sections.push("", `Confidence: ${payload.confidence || "low"}`);
    return sections.join("\n");
  }

  handleNoConsensus(current, orchestrator, lastRoundVotes) {
    this.logger.blockTitle("❌ No consensus reached after maximum rounds");
    this.logger.line(orchestrator, "consensus", `No consensus reached after ${this.maxRounds} rounds`);

    const okVotes = lastRoundVotes.filter((v) => v.res && v.res.ok);
    let winner, winnerId;

    if (okVotes.length > 0) {
      const tallies = this.calculateVoteTallies(current, okVotes);
      const maxScore = Math.max(...Array.from(tallies.values()).map((t) => t.score));
      winnerId = Array.from(tallies.entries()).find(([id, tally]) => tally.score === maxScore)?.[0];
      winner = current.find((p) => p.agentId === winnerId);
    } else {
      winnerId = current[0]?.agentId;
      winner = current[0];
    }

    const winningPayload = winner?.payload?.revised || winner?.payload;
    const finalAnswer = this.formatFinalAnswer(winningPayload);

    this.logger.blockTitle("===== BEST CANDIDATE =====");
    this.logger.line(orchestrator, "result", `Best proposal from ${winnerId}:\n${finalAnswer}`);
    this.logger.blockTitle("==========================");

    return finalAnswer;
  }
}
