import { DEFAULT_SYS_PROMPTS } from '../types.js';
import type { ActionHandlerOptions, ConversationLogger, Agent, Orchestrator, AgentSpawner, ResponseFormatter, ActionResult, ParseResult, ProposalPayload, ActionAgreePayload, AgentResponsePayload, SysPrompts } from '../types.js';

export class ActionHandler {
  logger: ConversationLogger | null;
  agents: Agent[];
  prompts: SysPrompts;
  agentSpawner: AgentSpawner | null;
  responseFormatter: ResponseFormatter | null;

  constructor(options: ActionHandlerOptions = {}) {
    this.logger = options.logger || null;
    this.agents = options.agents || [];
    this.prompts = options.prompts || DEFAULT_SYS_PROMPTS;
    this.agentSpawner = options.agentSpawner || null;
    this.responseFormatter = options.responseFormatter || null;
  }

  async checkAgreement(winningPayload: ProposalPayload, winnerId: string, orchestrator: Agent | Orchestrator): Promise<ActionResult> {
    const codePatch = winningPayload.code_patch;
    const tests = winningPayload.tests;
    const hasCodePatch = codePatch && codePatch.trim().length > 0;
    const hasTests = tests && tests.length > 0;

    if (!hasCodePatch && !hasTests) {
      this.logger.blockTitle("ℹ️ Proposal is informational only - no action needed");
      this.logger.line(orchestrator, "action", "The winning proposal contains no code or commands to execute");
      return { shouldExecute: false, actionable: false };
    }

    const winnerAgent = this.agents.find(a => a.id === winnerId);
    const winnerName = winnerAgent?.displayName || winnerId;

    const prompt = this.prompts.actionAgree
      .replace(/\{\{WINNER_AGENT\}\}/g, winnerName)
      .replace(/\{\{FINAL_ANSWER\}\}/g, this.responseFormatter.formatFinalAnswer(winningPayload));

    const otherAgents = this.agents.filter(a => a.id !== winnerId);

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
        const json = result.res.json as ActionAgreePayload;
        const isActionable = json.is_actionable;
        const agreed = json.agreed;
        if (isActionable && agreed) {
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

  async execute(actionResult: ActionResult, winningPayload: ProposalPayload, orchestrator: Agent | Orchestrator): Promise<ParseResult> {
    const winnerAgent = actionResult.winnerAgent;

    this.logger.line(orchestrator, "action", '🚀 Executing approved action...\n');

    const agent = this.agents.find(a => a.id === winnerAgent?.id);
    if (!agent) {
      this.logger.line(orchestrator, "action", `❌ Agent ${winnerAgent?.id} not found`);
      return { ok: false, json: {} as AgentResponsePayload, raw: "Agent not found" };
    }

    const proposal = winningPayload.proposal;
    const codePatch = winningPayload.code_patch;
    const tests = winningPayload.tests;
    let prompt = this.prompts.actionExecute || "";
    prompt = prompt.replace("{{PROPOSAL}}", proposal || "");
    prompt = prompt.replace("{{CODE_PATCH}}", codePatch ? `\`\`\`\n${codePatch}\n\`\`\`` : "");
    prompt = prompt.replace("{{TESTS}}", tests && tests.length > 0 ? "Tests to run:\n" + tests.join("\n") : "");
    prompt = prompt.replace("{{CWD}}", process.cwd());

    this.logger.line(orchestrator, "action", `Executing agent: ${agent.id} (${agent.displayName})...\n`);
    const result = await this.agentSpawner.spawn(agent, prompt, 300, "execute");

    if (result.ok) {
      this.logger.line(orchestrator, "action", '✅ Action executed successfully');
    } else {
      this.logger.line(orchestrator, "action", `❌ Action execution failed: ${result.error || 'unknown error'}`);
    }

    return result;
  }
}
