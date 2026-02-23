/**
 * DirectRunner - Non-interactive orchestration mode
 *
 * Runs orchestration directly with a question without the interactive UI.
 */

import { runOrchestration, configureOrchestration } from './orchestration.js';
import { ANSI } from './logger.js';

export class DirectRunner {
  constructor(options = {}) {
    this.logger = options.logger || null;
    this.processManager = options.processManager || null;
    this.agents = options.agents || [];
    this.prompts = options.prompts || {};
    this.config = options.config || {};
    this.noColor = this.config.noColor || false;
  }

  async run(question) {
    configureOrchestration({
      logger: this.logger,
      prompts: this.prompts,
      consensus: this.config.consensus,
      owner: this.config.owner,
      consensusMode: this.config.consensusMode,
      maxRounds: this.config.maxRounds,
      processManager: this.processManager,
    });

    try {
      const finalAnswer = await runOrchestration(question, this.agents, this.paint.bind(this));
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

  applyConfig(config) {
    if (!config) return;

    if (config.consensus) {
      this.config.consensusMode = config.consensus;
    }
    if (typeof config.maxRounds === 'number') {
      this.config.maxRounds = config.maxRounds;
    }

    const consensus = this.config.consensus || {};
    if (typeof config.unanimousPct === 'number') {
      consensus.unanimousPct = config.unanimousPct;
    }
    if (typeof config.superMajorityPct === 'number') {
      consensus.superMajorityPct = config.superMajorityPct;
    }
    if (typeof config.majorityPct === 'number') {
      consensus.majorityPct = config.majorityPct;
    }
    if (typeof config.allowBlockers === 'boolean') {
      consensus.requireNoBlockers = !config.allowBlockers;
    }
    if (typeof config.rubberPenalty === 'number') {
      consensus.rubberPenalty = config.rubberPenalty;
    }
    this.config.consensus = consensus;

    const owner = this.config.owner || { ids: [], minScore: 0.8, mode: 'any' };
    if (config.owner && Array.isArray(config.owner)) {
      owner.ids = config.owner;
    }
    if (typeof config.ownerMin === 'number') {
      owner.minScore = config.ownerMin;
    }
    if (config.ownerMode) {
      owner.mode = config.ownerMode === 'all' ? 'all' : 'any';
    }
    this.config.owner = owner;
  }
}
