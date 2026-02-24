export class ResponseFormatter {
  constructor(options = {}) {
    this.logger = options.logger || null;
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
}
