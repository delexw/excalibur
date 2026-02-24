export class PromptBuilder {
  constructor(options = {}) {
    this.agents = options.agents || [];
  }

  build(base, question, context = {}) {
    let prompt = base;
    if (prompt.includes("{{AGENTS}}")) {
      const agentList = JSON.stringify(this.agents.map((a) => ({ agent_id: a.id, agent_display_name: `>${a.displayName}` })), null, 2);
      prompt = prompt.replace("{{AGENTS}}", agentList);
    }
    prompt = prompt.replace(/\{\{QUESTION\}\}/g, question);
    prompt = prompt.replace(/\{\{CONTEXT\}\}/g, JSON.stringify(context, null, 2));
    return prompt;
  }
}
