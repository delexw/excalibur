/**
 * DirectRunner - Non-interactive orchestration mode
 *
 * Runs orchestration directly with a question without the interactive UI.
 */

import { Orchestrator } from './orchestration.js';
import { ANSI } from './logger.js';

export class DirectRunner {
  constructor(options = {}) {
    this.logger = options.logger || null;
    this.processManager = options.processManager || null;
    this.agents = options.agents || [];
    this.config = options.config || {};
    this.noColor = this.config.log?.noColor || false;
  }

  async run(question) {
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

  paint(txt, colour) {
    return ANSI.paint(txt, colour, this.noColor);
  }

  handleError(error) {
    console.error("Orchestration failed:", error.message);
    if (this.logger) {
      this.logger.line(
        { id: "orchestrator", displayName: "Orchestrator", color: "red" },
        "error",
        `Orchestration failed: ${error.message}`,
      );
    }
  }
}
