/**
 * DirectRunner - Non-interactive orchestration mode
 *
 * Runs orchestration directly with a question without the interactive UI.
 */

import { Orchestrator } from './orchestration.js';
import { ANSI } from './logger.js';
import type { Agent, ConfigSettings, ConversationLogger, ProcessManager, DirectRunnerResult } from './types.js';

interface DirectRunnerOptions {
  logger?: ConversationLogger | null;
  processManager?: ProcessManager | null;
  agents?: Agent[];
  config?: ConfigSettings;
}

export class DirectRunner {
  logger: ConversationLogger | null;
  processManager: ProcessManager | null;
  agents: Agent[];
  config: ConfigSettings;
  noColor: boolean;

  constructor(options: DirectRunnerOptions = {}) {
    this.logger = options.logger || null;
    this.processManager = options.processManager || null;
    this.agents = options.agents || [];
    this.config = options.config || {} as ConfigSettings;
    this.noColor = this.config.log?.noColor || false;
  }

  async run(question: string): Promise<DirectRunnerResult> {
    const orchestrator = new Orchestrator({
      logger: this.logger,
      prompts: this.config.sysPrompts,
      consensus: this.config.consensus,
      owner: this.config.owner,
      consensusMode: this.config.consensusMode,
      maxRounds: this.config.maxRounds,
      processManager: this.processManager,
      agents: this.agents,
      orchestrator: this.config.orchestrator,
    });

    try {
      const finalAnswer = await orchestrator.run(question, this.paint.bind(this));
      return { success: true, finalAnswer };
    } catch (error) {
      this.handleError(error);
      return { success: false, error: error.message };
    }
  }

  paint(txt: string, colour: string): string {
    return ANSI.paint(txt, colour, this.noColor);
  }

  handleError(error: Error): void {
    console.error("Orchestration failed:", error.message);
    if (this.logger) {
      this.logger.line(
        this.config.orchestrator,
        "error",
        `Orchestration failed: ${error.message}`,
      );
    }
  }
}
