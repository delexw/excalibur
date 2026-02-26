import type { ResponseFormatterOptions, ConversationLogger, ActionResult, ParseResult, ProposalPayload, ActionExecutePayload, Agent, Orchestrator } from '../types.js';

export class ResponseFormatter {
  logger: ConversationLogger | null;

  constructor(options: ResponseFormatterOptions = {}) {
    this.logger = options.logger || null;
  }

  formatActionResponse(actionResult: ActionResult, winningPayload: ProposalPayload, executionResult: ParseResult, orchestrator: Agent | Orchestrator): string {
    const winnerAgent = actionResult.winnerAgent;
    const execPayload = executionResult?.json as ActionExecutePayload;
    const response = {
      status: "action_approved",
      winner: { agent_id: actionResult.winnerId, display_name: winnerAgent?.displayName || actionResult.winnerId, avatar: winnerAgent?.avatar },
      agreement: { agreed: actionResult.agreedCount, total: actionResult.totalVoters, rate: actionResult.agreementRate },
      proposal: winningPayload.proposal,
      action: { type: "execute_agent", agent: { id: winnerAgent?.id, cmd: winnerAgent?.cmd, args: winnerAgent?.args }, code_patch: winningPayload.code_patch || null, tests: winningPayload.tests || [] },
      execution: { ok: executionResult?.ok || false, output: execPayload || null, error: executionResult?.error || null },
    };

    this.logger.blockTitle("🚀 Returning Action Response");
    this.logger.line(orchestrator, "action", JSON.stringify(response, null, 2));

    return execPayload?.output || "No output from action execution";
  }

  formatFinalAnswer(payload: ProposalPayload | undefined): string {
    if (!payload) return "No consensus reached";
    const sections: string[] = [];
    sections.push(payload.proposal || "(no proposal)");
    if (payload.code_patch) {
      sections.push("", "--- code_patch (unified diff) ---", payload.code_patch);
    }
    const tests = payload.tests;
    if (tests && tests.length) {
      sections.push("", "Tests to run:");
      tests.forEach((test) => sections.push(`- ${test}`));
    }
    const keyPoints = payload.key_points;
    if (keyPoints && keyPoints.length) {
      sections.push("", "Key points:");
      keyPoints.forEach((point) => sections.push(`- ${point}`));
    }
    sections.push("", `Confidence: ${payload.confidence || "low"}`);
    return sections.join("\n");
  }
}
