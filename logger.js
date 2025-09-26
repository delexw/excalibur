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
 * ConversationLogger is responsible for logging per‑agent messages to individual files
 * as well as producing a consolidated transcript at the end of a session.  It also
 * supports coloured console output for readability.
 */
export class ConversationLogger {
  constructor(baseDir, session, options = {}) {
    const { noColor = false, quiet = false } = options;
    this.baseDir = path.join(baseDir, session);
    fs.mkdirSync(this.baseDir, { recursive: true });
    this.streams = new Map();
    this.meta = { session, startedAt: new Date().toISOString(), events: [] };
    this.noColor = noColor;
    this.quiet = quiet;
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
  line(agent, phase, text) {
    const ts = new Date().toISOString();
    const stream = this.agentFile(agent.id);
    stream.write(`[${ts}] [${phase}] ${text}\n`);
    if (!this.quiet) {
      const tag = `${agent.avatar || '🤖'} ${agent.displayName || agent.id}`;
      const phaseLabel = ANSI.boldify(ANSI.paint(`[${phase}]`, agent.color || 'white', this.noColor), this.noColor);
      const tagColour = ANSI.paint(tag, agent.color || 'white', this.noColor);
      process.stdout.write(`${ANSI.paint('│', 'gray', this.noColor)} ${tagColour} ${phaseLabel} ${ANSI.paint('—', 'gray', this.noColor)} ${text}\n`);
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
    const width = Math.max(8, Math.min(80, process.stdout.columns || 80) - 4);
    const line = '─'.repeat(width);
    console.log(ANSI.paint(`\n┌${line}\n│ ${ANSI.boldify(title, this.noColor)}\n└${line}\n`, 'gray', this.noColor));
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