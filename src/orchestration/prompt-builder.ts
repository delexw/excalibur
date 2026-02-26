import type { Agent, PromptBuilderOptions, PromptContext } from '../types.js';

export class PromptBuilder {
  agents: Agent[];

  constructor(options: PromptBuilderOptions = {}) {
    this.agents = options.agents || [];
  }

  build(base: string, question: string, context: PromptContext = {}, _agents?: Agent[]): string {
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
