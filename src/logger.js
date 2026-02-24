import fs from 'node:fs';
import path from 'node:path';

// Minimal ANSI colour helper.  Colours can be disabled via the noColor flag in the
// constructor options.  You can pass an alternate colour palette if desired.
export const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  colors: {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
    white: '\x1b[37m',
  },
  paint(txt, colour, noColor = false) {
    if (noColor || !ANSI.colors[colour]) return txt;
    return ANSI.colors[colour] + txt + ANSI.reset;
  },
  boldify(txt, noColor = false) {
    return noColor ? txt : ANSI.bold + txt + ANSI.reset;
  },
};

/**
 * Universal color formatter - works for both ANSI (console) and blessed (UI)
 * @param {string} text - Text to format
 * @param {string} color - Color name
 * @param {Object} options - Formatting options
 * @param {boolean} options.bold - Whether to make text bold
 * @param {boolean} options.forBlessed - Use blessed tags (true) or ANSI codes (false)
 * @param {boolean} options.noColor - Disable colors (for ANSI only)
 * @returns {string} Formatted text
 */
function formatText(text, color = 'white', { bold = false, forBlessed = false, noColor = false } = {}) {
  if (!text) return text;
  if (noColor && !forBlessed) return text;

  if (forBlessed) {
    // Blessed tag format
    const colorTag = `{${color}-fg}${text}{/${color}-fg}`;
    return bold ? `{bold}${colorTag}{/bold}` : colorTag;
  } else {
    // ANSI code format
    const colored = ANSI.paint(text, color, noColor);
    return bold ? ANSI.boldify(colored, noColor) : colored;
  }
}

/**
 * Helper to highlight conversation patterns with agent-aligned colors
 * Works for both ANSI (console) and blessed (UI) output
 * @param {string} text - Text to highlight
 * @param {Array} agents - Array of agent objects
 * @param {Object} options - Formatting options
 * @param {boolean} options.forBlessed - Use blessed tags (true) or ANSI codes (false)
 * @param {boolean} options.noColor - Disable colors (for ANSI only)
 * @param {string} options.phase - Optional phase label to prepend
 * @param {string} options.phaseColor - Color for phase label
 * @returns {string} Highlighted text
 */
function highlightConversation(text, agents, { forBlessed = false, noColor = false, phase = null, phaseColor = 'white' } = {}) {
  if (!text) return text;

  let result = text;

  // Add phase label if provided
  if (phase) {
    const phaseLabel = formatText(`[${phase}]`, phaseColor, { bold: true, forBlessed, noColor });
    result = `${phaseLabel} ${result}`;
  } else {
    // Status messages (empty phase) - add visual distinction with gray color
    if (forBlessed) {
      result = `{gray-fg}${result}{/gray-fg}`;
    } else if (!noColor) {
      result = `${ANSI.paint(result, 'gray', noColor)}`;
    }
  }

  // Skip highlighting if colors disabled and not using blessed
  if (noColor && !forBlessed) return result;

  // Highlight agent mentions and conversation patterns
  if (agents) {
    for (const agent of agents) {
      const displayName = agent.displayName || agent.id;
      const agentColor = agent.color || 'white';

      // Highlight >mentions using the mentioned agent's color
      const mentionPattern = new RegExp(`(>${displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'g');
      result = result.replace(mentionPattern, (match) =>
        formatText(match, agentColor, { forBlessed, noColor })
      );

      // Highlight "You are absolutely right" when addressing this agent
      const rightPattern = new RegExp(`(>${displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^.]*?)([Yy]ou are absolutely right)`, 'g');
      result = result.replace(rightPattern, (_, prefix, phrase) =>
        prefix + formatText(phrase, agentColor, { bold: true, forBlessed, noColor })
      );

      // Highlight "However, I disagree with" when addressing this agent
      const disagreePattern = new RegExp(`(>${displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^.]*?)([Hh]owever, I disagree with)`, 'g');
      result = result.replace(disagreePattern, (_, prefix, phrase) =>
        prefix + formatText(phrase, agentColor, { bold: true, forBlessed, noColor })
      );
    }
  }

  return result;
}

/**
 * ConversationLogger is responsible for logging per‑agent messages to individual files
 * as well as producing a consolidated transcript at the end of a session.  It also
 * supports coloured console output for readability.
 */
export class ConversationLogger {
  constructor(baseDir, session, options = {}) {
    const { noColor = false, quiet = false, agents = [], blessedUI = null } = options;
    this.baseDir = path.join(baseDir, session);
    fs.mkdirSync(this.baseDir, { recursive: true });
    this.streams = new Map();
    this.meta = { session, startedAt: new Date().toISOString(), events: [] };
    this.noColor = noColor;
    this.quiet = quiet;
    this.agents = agents;
    this.blessedUI = blessedUI;
  }

  /**
   * Set the blessed UI instance for output routing
   * @param {Object} blessedUI - BlessedUI instance
   */
  setBlessedUI(blessedUI) {
    this.blessedUI = blessedUI;
  }
  // Returns a writable stream for the given agent ID, creating it if needed
  agentFile(agentId) {
    if (!this.streams.has(agentId)) {
      const fp = path.join(this.baseDir, `agent-${agentId}.log`);
      this.streams.set(agentId, fs.createWriteStream(fp, { flags: 'a' }));
    }
    return this.streams.get(agentId);
  }




  /**
   * Write a log line on behalf of a particular agent.  The line is written to
   * the agent's file, the console (unless quiet) and recorded in the meta
   * transcript.  The phase describes the stage of the discussion (e.g.
   * "proposal", "critique").
   */
  line(agent, phase, text, fileOnly = false) {
    if (!agent?.id) {
      console.warn('Logger: agent.id is missing, skipping file log');
      return;
    }

    const ts = new Date().toISOString();
    const stream = this.agentFile(agent.id);

    stream.write(`[${ts}] [${phase}] ${text}\n`);

    if (!this.quiet && !fileOnly) {
      const tag = `${agent.avatar || '🤖'} ${agent.displayName || agent.id}`;
      const agentColor = agent.color || 'white';

      // If blessed UI is active, send to blessed UI instead of stdout
      if (this.blessedUI) {
        // Use unified highlighting function with blessed tags
        const blessedOutput = highlightConversation(text, this.agents, {
          forBlessed: true,
          phase,
          phaseColor: agentColor
        });

        // Orchestrator logs go to orchestration panel (if available), others to agent panels
        if (agent.id === 'orchestrator' && this.blessedUI.setHeaderMessage) {
          this.blessedUI.setHeaderMessage(blessedOutput);
        } else {
          this.blessedUI.appendToAgent(agent.id, blessedOutput);
        }
      } else {
        // Use unified highlighting function with ANSI codes
        const consoleOutput = highlightConversation(text, this.agents, {
          forBlessed: false,
          noColor: this.noColor,
          phase,
          phaseColor: agentColor
        });
        const tagColour = ANSI.paint(tag, agentColor, this.noColor);
        process.stdout.write(`${ANSI.paint('│', 'gray', this.noColor)} ${tagColour} ${ANSI.paint('➤', 'cyan', this.noColor)} ${consoleOutput}\n\n`);
      }
    }

    this.meta.events.push({ t: ts, agentId: agent.id, phase, text });
  }
  /**
   * Print a decorated section header to the console to separate rounds or
   * phases.  The header uses unicode box‑drawing characters and can be
   * disabled via the quiet flag.
   */
  blockTitle(title) {
    if (this.quiet) return;

    if (this.blessedUI) {
      // Send to orchestration log in blessed UI
      this.blessedUI.setHeaderMessage(`\n━━━ ${title} ━━━\n`);
    } else {
      // Normal console output
      const width = Math.max(8, Math.min(80, process.stdout.columns || 80) - 4);
      const line = '─'.repeat(width);
      // Add more spacing and visual emphasis for better stage separation
      console.log(ANSI.paint(`\n\n┌${line}┐\n│ ${ANSI.boldify(title, this.noColor)} │\n└${line}┘\n`, 'cyan', this.noColor));
    }
  }
  /**
   * Generate a human‑readable transcript and a JSON meta file.  The report
   * includes simple scorecards for each agent.  Scorecards should be
   * calculated by the orchestrator and passed in here.
   */
  summary(scorecards) {
    const md = [];
    md.push(`# Session ${this.meta.session}\n`);
    md.push(`Started: ${this.meta.startedAt}\n`);
    md.push(`\n## Scorecards`);
    for (const card of scorecards) {
      md.push(`\n### ${card.avatar || '🤖'} ${card.displayName || card.agentId}`);
      md.push(`- Avg peer score: **${card.avgPeerScore?.toFixed(2) ?? 'n/a'}**`);
      md.push(`- Novel critiques: **${card.novelCritiques}**`);
      md.push(`- Blockers raised: **${card.blockers}**`);
      md.push(`- Rubber‑stamp tendency: **${card.rubber ? 'Yes' : 'No'}**`);
    }
    md.push(`\n## Timeline\n`);
    for (const e of this.meta.events) {
      md.push(`- ${e.t} — **${e.agentId} / ${e.phase}**: ${e.text.slice(0, 2000)}`);
    }
    fs.writeFileSync(path.join(this.baseDir, 'transcript.json'), JSON.stringify(this.meta, null, 2));
    fs.writeFileSync(path.join(this.baseDir, 'transcript.md'), md.join('\n'));
    if (!this.quiet) {
      console.log(ANSI.paint(`\n🧾 Logs written to ${this.baseDir}`, 'gray', this.noColor));
    }
  }
  // Close all file streams
  end() {
    for (const s of this.streams.values()) s.end();
  }
}