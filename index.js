#!/usr/bin/env node
/**
 * Multi‑agent orchestration CLI with debate, critique, voting and consensus.
 *
 * This script coordinates a panel of AI model CLIs, runs structured
 * discussions (proposal → critique → vote), and synthesises a final
 * answer.  It supports configurable consensus thresholds (unanimous,
 * super‑majority, majority), presets for team‑like behaviour, optional
 * code‑owner approvals and detailed logging.
 *
 * Usage:
 *   node index.js "Your question here" [--maxRounds=5] [--consensus=super] [--preset=team]
 *   Flags:
 *     --maxRounds=N        Maximum rounds of critique/vote cycles (default 5)
 *     --consensus=MODE     unanimous|super|majority (default super)
 *     --preset=NAME        strict|default|fast|experiment|team
 *     --unanimousPct=X     Override unanimous threshold (0–1)
 *     --superMajorityPct=X Override super majority threshold (0–1)
 *     --majorityPct=X      Override simple majority threshold (0–1)
 *     --allow-blockers     Allow consensus even with unresolved blocker critiques
 *     --rubberPenalty=X    Penalty weight (0–1) for rubber‑stamping agents
 *     --owner=ID1,ID2,...  Require one or more agents to approve the winner
 *     --ownerMin=X         Minimum score required from owners (default 0.8)
 *     --ownerMode=any|all  Require any or all owners to approve (default any)
 *     --logDir=DIR         Directory for session logs (default "logs")
 *     --sessionTag=TAG      Custom tag for this session
 *     --quiet              Suppress console logs (still writes log files)
 *     --no-color           Disable ANSI colour output
 *
 * See README.md for more details.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
// Additional imports to support file resolution and external helpers
import { fileURLToPath } from 'node:url';
import { ANSI, ConversationLogger } from './logger.js';
import { InteractiveTerminal, LogoRenderer, CommandParser, TerminalDisplay, SessionManager } from './interactive.js';

// ----- Signal handling for graceful shutdown --------------------------------
const activeProcesses = new Set();

// Make activeProcesses globally accessible for interactive mode
global.activeProcesses = activeProcesses;

// Global flag to signal orchestration interruption
global.orchestrationInterrupted = false;

// Constant for interruption error message
const INTERRUPTION_ERROR = 'Interrupted by user';

// Generic function to log agent responses immediately based on phase
function logAgentResponse(agent, json, phase) {
  switch (phase) {
    case 'proposal':
    case 'propose':
      const proposal = json.proposal || json.answer || 'No proposal provided';
      const confidence = json.confidence ? ` I'm ${json.confidence} confident about this.` : '';
      LOGGER.line(agent, 'proposal', `My proposal: ${proposal}${confidence}`);
      break;

    case 'critique':
      const critiques = json.critiques || [];
      if (critiques.length > 0) {
        for (const c of critiques) {
          const conversationMsg = c.conversation_message;
          if (conversationMsg) {
            LOGGER.line(agent, 'critique', highlightConversation(conversationMsg, getAgentsForHighlighting()));
          }
        }
      } else {
        LOGGER.line(agent, 'critique', 'The current proposals look solid to me.');
      }
      break;

    case 'revision':
    case 'revise':
      const responses = json.response_to_feedback || [];
      for (const response of responses) {
        const conversationMsg = response.conversation_message;
        if (conversationMsg) {
          LOGGER.line(agent, 'revision', highlightConversation(conversationMsg, getAgentsForHighlighting()));
        }
      }
      break;

    case 'vote':
      const conversationMsg = json.conversation_message;
      if (conversationMsg) {
        LOGGER.line(agent, 'vote', highlightConversation(conversationMsg, getAgentsForHighlighting()));
      } else {
        LOGGER.line(agent, 'error', 'Missing conversation_message for vote response');
      }
      break;

    default:
      // Generic fallback - try to find any meaningful content
      const content = json.proposal || json.answer || json.response || json.content || JSON.stringify(json);
      LOGGER.line(agent, phase, content);
      break;
  }
}

// Helper to get agents for conversation highlighting (will be set by round functions)
let currentAgents = [];
function getAgentsForHighlighting() {
  return currentAgents;
}

// Helper function to check for interruption and return consistent error result
function checkInterruption(agent, format = 'spawn') {
  if (!global.orchestrationInterrupted) {
    return null;
  }

  switch (format) {
    case 'spawn':
      return { ok: false, error: INTERRUPTION_ERROR, output: '', agent };
    case 'round':
      return { agentId: agent?.id, error: INTERRUPTION_ERROR, raw: null };
    case 'boolean':
      return true;
    default:
      return { ok: false, error: INTERRUPTION_ERROR, output: '', agent };
  }
}

function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}. Terminating active processes...`);
  for (const child of activeProcesses) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ----- CLI argument parsing -------------------------------------------------
const argv = process.argv.slice(2);

// Show help if requested
if (argv.includes('-h') || argv.includes('--help')) {
  console.log(`⚔️  Excalibur CLI - Multi-agent orchestration with debate and consensus

USAGE:
  excalibur                          (interactive mode - default)
  excalibur "Your question" [options] (direct mode)
  node index.js "Your question" [options]

OPTIONS:
  --maxRounds=N         Maximum rounds of critique/vote cycles (default: 5)
  --consensus=MODE      Consensus mode: unanimous|super|majority (default: super)
  --preset=NAME         Apply preset: strict|default|fast|experiment|team
  --unanimousPct=X      Override unanimous threshold (0-1, default: 0.75)
  --superMajorityPct=X  Override super majority threshold (0-1, default: 0.75)
  --majorityPct=X       Override majority threshold (0-1, default: 0.5)
  --allow-blockers      Allow consensus even with unresolved blocker critiques
  --rubberPenalty=X     Penalty weight for rubber-stamping agents (0-1, default: 0.5)
  --owner=ID1,ID2,...   Require one or more agents to approve the winner
  --ownerMin=X          Minimum score required from owners (default: 0.8)
  --ownerMode=any|all   Require any or all owners to approve (default: any)
  --logDir=DIR          Directory for session logs (default: "logs")
  --sessionTag=TAG      Custom tag for this session
  --quiet               Suppress console output (still writes logs)
  --no-color            Disable ANSI color output
  --interactive         Start interactive terminal mode
  -h, --help            Show this help message

EXAMPLES:
  excalibur                                      (starts interactive mode)
  excalibur "How to optimize database queries?" --preset=team --maxRounds=3
  excalibur "Design a REST API" --consensus=unanimous --owner=claude,gemini
  excalibur "Explain async/await" --preset=fast

For more information, see: https://github.com/delexw/excalibur`);
  process.exit(0);
}

// No longer exit if no arguments - interactive mode is now default

// Helper to pick the first non‑flag argument as the user question
const userQuestion = argv.find(a => !a.startsWith('--'));
// Helpers to read numeric and string flags
function numFlag(name, def) {
  const v = (argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1];
  return v ? Number(v) : def;
}
function strFlag(name, def) {
  const v = (argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1];
  return v || def;
}

// Consensus mode (unanimous|super|majority); default super
let consensusMode = strFlag('consensus', 'super');
// Maximum critique/vote rounds; default 5
let maxRounds = numFlag('maxRounds', 5);

// ----- Logging configuration -----------------------------------------------
const LOG = {
  dir: strFlag('logDir', 'logs'),
  session: strFlag('sessionTag', new Date().toISOString().replace(/[:.]/g, '-')),
  noColor: argv.includes('--no-color'),
  quiet: argv.includes('--quiet'),
};

// Legacy inline ANSI and ConversationLogger removed in favour of imported versions.

// Resolve this module's directory to locate prompt files
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load prompts from markdown files within the prompts directory
const PROMPT_DIR = path.join(__dirname, 'prompts');
const PROMPTS = {
  propose: fs.readFileSync(path.join(PROMPT_DIR, 'propose.md'), 'utf8').trim(),
  critique: fs.readFileSync(path.join(PROMPT_DIR, 'critique.md'), 'utf8').trim(),
  revise: fs.readFileSync(path.join(PROMPT_DIR, 'revise.md'), 'utf8').trim(),
  vote: fs.readFileSync(path.join(PROMPT_DIR, 'vote.md'), 'utf8').trim(),
};

// Colour wrapper helpers using imported ANSI and the noColor flag
const paint = (txt, colour) => ANSI.paint(txt, colour, LOG.noColor);

// Helper to highlight conversation patterns with agent-aligned colors
function highlightConversation(text, agents, noColor = LOG.noColor) {
  if (noColor) return text;

  // Highlight @mentions and align "You are absolutely right" with target agent's color
  if (agents) {
    for (const agent of agents) {
      const displayName = agent.displayName || agent.id;
      const agentColor = agent.color || 'white';

      // Highlight @mentions using the mentioned agent's color
      const mentionPattern = new RegExp(`(@${displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'g');
      text = text.replace(mentionPattern, ANSI.paint('$1', agentColor, noColor));

      // Highlight "You are absolutely right" or "you are absolutely right" when addressing this agent
      const rightPattern = new RegExp(`(@${displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^.]*?)([Yy]ou are absolutely right)`, 'g');
      text = text.replace(rightPattern, (match, prefix, phrase) =>
        prefix + ANSI.boldify(ANSI.paint(phrase, agentColor, noColor), noColor)
      );

      // Highlight "However, I disagree with" or "however, I disagree with" when addressing this agent
      const disagreePattern = new RegExp(`(@${displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^.]*?)([Hh]owever, I disagree with)`, 'g');
      text = text.replace(disagreePattern, (match, prefix, phrase) =>
        prefix + ANSI.boldify(ANSI.paint(phrase, agentColor, noColor), noColor)
      );
    }
  }



  return text;
}

// Global conversation logger instantiation with colour and quiet options
const LOGGER = new ConversationLogger(LOG.dir, LOG.session, { noColor: LOG.noColor, quiet: LOG.quiet });

// ----- Orchestration parameters -------------------------------------------
// Debate/critique heuristics
const DELIB = {
  minNovelCritiquesPerRound: 1,
  requireMajorOrBlockerWhenWarranted: true,
  blockerSeverity: 'blocker',
  weightPenaltyRubberStamp: 0.5,
};

// Consensus thresholds (defaults); override via flags or presets
const CONSENSUS = {
  unanimousPct: 0.75,
  superMajorityPct: 0.75,
  majorityPct: 0.5,
  requireNoBlockers: true,
};

// Preset definitions; override CONSENSUS and DELIB fields when selected
const PRESETS = {
  strict:     { unanimousPct: 0.85, superMajorityPct: 0.8,  majorityPct: 0.6,  requireNoBlockers: true,  rubberPenalty: 0.35 },
  default:    { unanimousPct: 0.75, superMajorityPct: 0.75, majorityPct: 0.5,  requireNoBlockers: true,  rubberPenalty: 0.5  },
  fast:       { unanimousPct: 0.7,  superMajorityPct: 0.66, majorityPct: 0.5,  requireNoBlockers: false, rubberPenalty: 0.6  },
  experiment: { unanimousPct: 0.6,  superMajorityPct: 0.6,  majorityPct: 0.5,  requireNoBlockers: false, rubberPenalty: 0.7  },
  team:       { unanimousPct: 0.8,  superMajorityPct: 0.75, majorityPct: 0.55, requireNoBlockers: true,  rubberPenalty: 0.35 },
};
// Apply preset if specified
const presetName = strFlag('preset', '');
if (presetName && PRESETS[presetName]) {
  const p = PRESETS[presetName];
  CONSENSUS.unanimousPct = p.unanimousPct;
  CONSENSUS.superMajorityPct = p.superMajorityPct;
  CONSENSUS.majorityPct = p.majorityPct;
  CONSENSUS.requireNoBlockers = p.requireNoBlockers;
  DELIB.weightPenaltyRubberStamp = p.rubberPenalty;
}

// Override consensus thresholds and penalties via flags
CONSENSUS.unanimousPct     = numFlag('unanimousPct',     CONSENSUS.unanimousPct);
CONSENSUS.superMajorityPct = numFlag('superMajorityPct', CONSENSUS.superMajorityPct);
CONSENSUS.majorityPct      = numFlag('majorityPct',      CONSENSUS.majorityPct);
DELIB.weightPenaltyRubberStamp = numFlag('rubberPenalty', DELIB.weightPenaltyRubberStamp);
// allow-blockers flag disables requireNoBlockers
if (argv.includes('--allow-blockers')) {
  CONSENSUS.requireNoBlockers = false;
}

// Owner approval flags
const OWNER = {
  ids: (strFlag('owner', '').trim() ? strFlag('owner', '').split(',').map(s => s.trim()).filter(Boolean) : []),
  minScore: numFlag('ownerMin', 0.8),
  mode: (strFlag('ownerMode', 'any') === 'all' ? 'all' : 'any'),
};

/**
 * Apply runtime configuration to global settings
 * @param {Object} config - Configuration object from interactive mode
 */
function applyRuntimeConfig(config) {
  if (!config) return;

  // Core orchestration settings
  if (config.consensus) {
    consensusMode = config.consensus;
  }
  if (typeof config.maxRounds === 'number') {
    maxRounds = config.maxRounds;
  }

  // Consensus thresholds
  if (typeof config.unanimousPct === 'number') {
    CONSENSUS.unanimousPct = config.unanimousPct;
  }
  if (typeof config.superMajorityPct === 'number') {
    CONSENSUS.superMajorityPct = config.superMajorityPct;
  }
  if (typeof config.majorityPct === 'number') {
    CONSENSUS.majorityPct = config.majorityPct;
  }

  // Behavioral controls
  if (typeof config.allowBlockers === 'boolean') {
    CONSENSUS.requireNoBlockers = !config.allowBlockers;
  }
  if (typeof config.rubberPenalty === 'number') {
    DELIB.weightPenaltyRubberStamp = config.rubberPenalty;
  }

  // Owner approval settings
  if (config.owner && Array.isArray(config.owner)) {
    OWNER.ids = config.owner;
  }
  if (typeof config.ownerMin === 'number') {
    OWNER.minScore = config.ownerMin;
  }
  if (config.ownerMode) {
    OWNER.mode = config.ownerMode === 'all' ? 'all' : 'any';
  }

  // Logging settings (note: these affect the global LOG object)
  if (config.logDir) {
    LOG.dir = config.logDir;
  }
  if (config.sessionTag) {
    LOG.session = config.sessionTag;
  }
  if (typeof config.quiet === 'boolean') {
    LOG.quiet = config.quiet;
  }
  if (typeof config.noColor === 'boolean') {
    LOG.noColor = config.noColor;
  }
}



// ----- Helpers -------------------------------------------------------------
// Extract the JSON body from agent output using format-specific approach
function normalizeJsonText(txt) {
  // Handle Codex FIRST - extract content between [timestamp] codex and [timestamp] tokens used
  if (txt.includes('OpenAI Codex') || /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\]\s*codex/.test(txt)) {
    const lines = txt.split('\n');
    let codexLineIdx = -1;
    let tokensLineIdx = -1;

    // Find the line that contains timestamp + "codex"
    for (let i = 0; i < lines.length; i++) {
      if (/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\]\s*codex/.test(lines[i])) {
        codexLineIdx = i;
        break;
      }
    }

    // Find the line that contains "tokens used" after the codex line
    if (codexLineIdx >= 0) {
      for (let i = codexLineIdx + 1; i < lines.length; i++) {
        if (lines[i].includes('tokens used')) {
          tokensLineIdx = i;
          break;
        }
      }
    }

    // Extract content between these two lines, filtering out empty lines
    if (codexLineIdx >= 0 && tokensLineIdx > codexLineIdx) {
      const contentLines = lines.slice(codexLineIdx + 1, tokensLineIdx).filter(line => line.trim() !== '');
      txt = contentLines.join('\n').trim();
    } else if (codexLineIdx >= 0) {
      // If no tokens line found, take everything after codex line
      const contentLines = lines.slice(codexLineIdx + 1).filter(line => line.trim() !== '');
      txt = contentLines.join('\n').trim();
    }

    // For Codex, try to validate the extracted JSON immediately
    try {
      JSON.parse(txt);
      return txt;
    } catch (e) {
      // If JSON parsing fails, try to find just the outermost braces
      const first = txt.indexOf('{');
      const last = txt.lastIndexOf('}');
      if (first >= 0 && last > first) {
        const candidate = txt.slice(first, last + 1);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch (e2) {
          // If that fails too, return the original extracted text
          return txt;
        }
      }
      return txt;
    }
  }

  // Handle Gemini - remove markdown code blocks if present
  if (txt.includes('```json')) {
    const jsonStart = txt.indexOf('```json') + 7;
    const jsonEnd = txt.indexOf('```', jsonStart);
    if (jsonEnd > jsonStart) {
      txt = txt.slice(jsonStart, jsonEnd).trim();
    }
  }

  // Generic fallback - find the outermost JSON object
  const first = txt.indexOf('{');
  const last = txt.lastIndexOf('}');

  if (first >= 0 && last > first) {
    // Extract content between first { and last }
    const jsonCandidate = txt.slice(first, last + 1).trim();

    // Validate it's proper JSON by trying to parse
    try {
      JSON.parse(jsonCandidate);
      return jsonCandidate;
    } catch (e) {
      // If parsing fails, fall back to original text
      return txt.trim();
    }
  }

  // If no braces found, return original text
  return txt.trim();
}

// Build a prompt for an agent with optional context
function buildPrompt(base, question, context = {}, agents = []) {
  // Replace {{AGENTS}} placeholder with agent list
  let prompt = base;
  if (prompt.includes('{{AGENTS}}')) {
    const agentList = JSON.stringify(agents.map(agent => ({
      agent_id: agent.id,
      agent_display_name: `@${agent.displayName}`
    })), null, 2);
    prompt = prompt.replace('{{AGENTS}}', agentList);
  }

  return `${prompt}\n\nUSER QUESTION:\n${question}\n\nCONTEXT:\n${JSON.stringify(context, null, 2)}\n\nReturn JSON only.`;
}

// Validate agents configuration
function validateAgents(agents) {
  const errors = [];
  const seenIds = new Set();
  const seenDisplayNames = new Set();

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const prefix = `Agent ${i + 1}`;

    // Check required fields
    if (!agent.id || typeof agent.id !== 'string') {
      errors.push(`${prefix}: missing or invalid 'id' field`);
    }
    if (!agent.displayName || typeof agent.displayName !== 'string') {
      errors.push(`${prefix}: missing or invalid 'displayName' field`);
    }
    if (!agent.cmd || typeof agent.cmd !== 'string') {
      errors.push(`${prefix}: missing or invalid 'cmd' field`);
    }
    if (!Array.isArray(agent.args)) {
      errors.push(`${prefix}: 'args' must be an array`);
    }

    // Check for duplicates
    if (agent.id) {
      if (seenIds.has(agent.id)) {
        errors.push(`${prefix}: duplicate agent id '${agent.id}'`);
      } else {
        seenIds.add(agent.id);
      }
    }

    if (agent.displayName) {
      if (seenDisplayNames.has(agent.displayName)) {
        errors.push(`${prefix}: duplicate displayName '${agent.displayName}'`);
      } else {
        seenDisplayNames.add(agent.displayName);
      }
    }

    // Check args contains {PROMPT} placeholder
    if (Array.isArray(agent.args) && !agent.args.some(arg => arg.includes('{PROMPT}'))) {
      errors.push(`${prefix}: 'args' array must contain '{PROMPT}' placeholder`);
    }

    // Validate optional numeric fields
    if (agent.timeoutMs !== undefined && (!Number.isInteger(agent.timeoutMs) || agent.timeoutMs <= 0)) {
      errors.push(`${prefix}: 'timeoutMs' must be a positive integer`);
    }

    // Validate optional string fields
    if (agent.inputMode !== undefined && !['arg', 'stdin'].includes(agent.inputMode)) {
      errors.push(`${prefix}: 'inputMode' must be 'arg' or 'stdin'`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`agents.json validation failed:\n  ${errors.join('\n  ')}`);
  }
}

// Load agents from agents.json, assigning default avatars/colours if missing
function loadAgents() {
  const agentsPath = path.join(process.cwd(), 'agents.json');
  if (!fs.existsSync(agentsPath)) throw new Error('Missing agents.json');
  const list = JSON.parse(fs.readFileSync(agentsPath, 'utf8'));
  if (!Array.isArray(list) || list.length === 0) throw new Error('agents.json has no agents');

  // Validate the configuration
  validateAgents(list);

  return list.map(cfg => ({
    avatar: cfg.avatar || '🤖',
    color:  cfg.color  || 'white',
    ...cfg,
  }));
}

// Spawn an agent CLI process with prompt; return JSON output or error (single attempt)
async function spawnAgentOnce(agent, prompt, timeoutSec, phase = 'response') {
  return new Promise((resolve) => {
    let resolved = false;

    const args = (agent.args || []).map(a => a.replace('{PROMPT}', prompt));
    let child;
    try {
      child = spawn(agent.cmd, args, {
        stdio: ['inherit', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: '',
        }
      });
      activeProcesses.add(child);
    } catch (err) {
      // Failed to spawn (e.g. command not found). Resolve immediately
      resolve({ ok: false, error: `Failed to spawn ${agent.cmd}: ${err.message}` });
      return;
    }
    let stdout = '';
    let stderr = '';
    let wasKilledByTimeout = false;

    // Only check for interruption when child process is actually killed by killAllAgents
    // No polling - rely on process termination signals
    const timer = setTimeout(() => {
      wasKilledByTimeout = true;
      child.kill('SIGKILL');
    }, Math.max(agent.timeoutMs || timeoutSec * 1000, timeoutSec * 1000));
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    // Handle spawn error events
    child.on('error', err => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        activeProcesses.delete(child);
        resolve({ ok: false, error: `Spawn error: ${err.message}` });
      }
    });
    child.on('close', code => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        activeProcesses.delete(child);

        // Check for interruption before processing results
        const interruption = checkInterruption(agent);
        if (interruption) {
          resolve(interruption);
          return;
        }

        if (wasKilledByTimeout) {
          const timeoutMs = Math.max(agent.timeoutMs || timeoutSec * 1000, timeoutSec * 1000);
          resolve({ ok: false, error: `Process killed by timeout after ${timeoutMs}ms` });
        } else if (code !== 0 && !stdout.trim()) {
          resolve({ ok: false, error: `Exited with code ${code}: ${stderr}` });
        } else {
          try {
            const normalizedJsonText = normalizeJsonText(stdout);
            const json = JSON.parse(normalizedJsonText);
            LOGGER.line(agent, 'response:json', normalizedJsonText, true); // Log JSON response to file only

            // Log the response immediately - generic for any phase
            logAgentResponse(agent, json, phase);

            resolve({ ok: true, json, raw: stdout });
          } catch (parseErr) {
            resolve({ ok: false, error: `Non‑JSON or parse error from ${agent.id}: ${parseErr.message}`, raw: parseErr });
          }
        }
      }
    });
    // With stdio: ['inherit', 'pipe', 'inherit'], stdin is inherited from parent
    // All agents should use 'arg' inputMode, not 'stdin'
  });
}

// Spawn an agent CLI process with retry logic for failed attempts
async function spawnAgent(agent, prompt, timeoutSec, phase = 'response') {
  const maxRetries = 3; // Retry Claude CLI calls, others once only
  const baseDelay = 1000; // 1 second base delay

  let lastResult;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Check for interruption before each attempt
    const interruption = checkInterruption(agent);
    if (interruption) {
      return interruption;
    }

    const result = await spawnAgentOnce(agent, prompt, timeoutSec, phase);
    lastResult = result;

    if (result.ok) {
      if (attempt > 1) {
        LOGGER.line(agent, 'retry:success', `Succeeded on attempt ${attempt}/${maxRetries}`, true);
      }


      return result;
    }

    // Don't retry on command not found (system configuration issues)
    if (result.error?.includes('Failed to spawn')) {
      return result;
    }

    // Log retry attempt only if we're not on the final attempt
    if (attempt < maxRetries) {
      const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff: 1s, 2s, 4s
      LOGGER.line(agent, 'retry:attempt', `Attempt ${attempt}/${maxRetries} failed: ${result.error}. Retrying in ${delay}ms`, true);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // All attempts failed - log exhausted and return the last result
  LOGGER.line(agent, 'retry:exhausted', `All ${maxRetries} attempts failed. Final error: ${lastResult.error}`);
  return lastResult;
}

// Round: proposals — run propose prompt for each agent
async function roundPropose(agents, question) {
  // Set currentAgents for conversation highlighting
  currentAgents = agents;

  // Check for interruption before starting any agents
  if (checkInterruption(null, 'boolean')) {
    // Don't start any agents if already interrupted
    return [];
  }

  const promises = agents.map(async (agent) => {
    const prompt = buildPrompt(PROMPTS.propose, question, {}, agents);
    LOGGER.line(agent, 'prompt:full', prompt, true); // Log full prompt to file only
    const res = await spawnAgent(agent, prompt, 60, 'proposal');
    if (!res.ok) {
      // Don't log interruption errors to keep ESC clean
      if (res.error !== INTERRUPTION_ERROR) {
        LOGGER.line(agent, 'error', res.error || 'Unknown error');
      }
      return { agentId: agent.id, error: res.error, raw: res.raw };
    }
    // Response logging is handled in logAgentResponse
    return { agentId: agent.id, res };
  });

  return Promise.all(promises);
}

// Round: critique — each agent reviews peers and can revise
async function roundCritique(agents, question, current) {
  // Set currentAgents for conversation highlighting
  currentAgents = agents;

  // Check for interruption before starting any agents
  if (checkInterruption(null, 'boolean')) {
    // Don't start any agents if already interrupted
    return [];
  }

  const promises = agents.map(async (agent) => {
    const orig = current.find(p => p.agentId === agent.id)?.payload || {};
    // Filter out current agent's proposal to avoid duplication with your_original
    const otherProposals = current.filter(p => p.agentId !== agent.id).map(p => ({ agentId: p.agentId, ...p.payload }));
    const context = { proposals: otherProposals, your_original: orig };
    const prompt = buildPrompt(PROMPTS.critique, question, context, agents);
    LOGGER.line(agent, 'prompt:full', prompt, true); // Log full prompt to file only
    const res = await spawnAgent(agent, prompt, 60, 'critique');
    if (!res.ok) {
      // Don't log interruption errors to keep ESC clean
      if (res.error !== INTERRUPTION_ERROR) {
        LOGGER.line(agent, 'error', res.error || 'Unknown error');
      }
      return { agentId: agent.id, error: res.error, raw: res.raw };
    }
    // Critique logging is handled in logAgentResponse
    return { agentId: agent.id, res };
  });

  return Promise.all(promises);
}

// Round: revise — each agent updates their proposal based on received feedback
async function roundRevise(agents, question, current, critiques) {
  // Set currentAgents for conversation highlighting
  currentAgents = agents;

  // Collect feedback for each agent
  const feedbackByAgent = new Map();
  for (const crit of critiques.filter(c => c.res && c.res.ok)) {
    for (const critique of (crit.res.json.critiques || [])) {
      const target = critique.target_agent;
      if (!feedbackByAgent.has(target)) {
        feedbackByAgent.set(target, []);
      }
      // Process each critique point for this target agent
      for (const point of (critique.points || [])) {
        feedbackByAgent.get(target).push({
          from_agent: crit.agentId,
          severity: point.severity,
          issue: point.claim_or_line,
          rationale: point.rationale,
          suggested_fix: point.suggested_fix
        });
      }
    }
  }

  // Check for interruption before starting any agents
  if (checkInterruption(null, 'boolean')) {
    // Don't start any agents if already interrupted
    return [];
  }

  const promises = agents.map(async (agent) => {
    const feedback = feedbackByAgent.get(agent.id) || [];
    const originalProposal = current.find(p => p.agentId === agent.id)?.payload || {};

    if (feedback.length === 0) {
      return { agentId: agent.id, res: { ok: true, json: { revised: originalProposal } } };
    }

    const context = {
      your_original_proposal: originalProposal,
      feedback_received: feedback
    };
    const prompt = buildPrompt(PROMPTS.revise, question, context, agents);
    LOGGER.line(agent, 'prompt:full', prompt, true); // Log full prompt to file only
    const res = await spawnAgent(agent, prompt, 60, 'revision');

    if (!res.ok) {
      // Don't log interruption errors to keep ESC clean
      if (res.error !== INTERRUPTION_ERROR) {
        LOGGER.line(agent, 'error', res.error || 'Unknown error');
      }
      return { agentId: agent.id, error: res.error, raw: res.raw };
    }

    // Revision logging is handled in logAgentResponse
    return { agentId: agent.id, res };
  });

  return Promise.all(promises);
}

// Round: vote — each agent scores candidates
async function roundVote(agents, question, current) {
  // Set currentAgents for conversation highlighting
  currentAgents = agents;

  // Check for interruption before starting any agents
  if (checkInterruption(null, 'boolean')) {
    // Don't start any agents if already interrupted
    return [];
  }

  const extras = { candidates: current.map(c => ({ agentId: c.agentId, payload: c.payload })) };
  const promises = agents.map(async (agent) => {
    const prompt = buildPrompt(PROMPTS.vote, question, extras, agents);
    LOGGER.line(agent, 'prompt:full', prompt, true); // Log full prompt to file only
    const res = await spawnAgent(agent, prompt, 60, 'vote');
    if (!res.ok) {
      // Don't log interruption errors to keep ESC clean
      if (res.error !== INTERRUPTION_ERROR) {
        LOGGER.line(agent, 'error', res.error || 'Unknown error');
      }
      return { agentId: agent.id, error: res.error, raw: res.raw };
    }
    // Vote logging is handled in logAgentResponse
    return { agentId: agent.id, res };
  });

  return Promise.all(promises);
}

// Novelty score: count new critique pairs (target|severity|claim) to discourage repeats
function noveltyScore(critiques, seen) {
  let novel = 0;
  for (const c of (critiques || [])) {
    for (const point of (c.points || [])) {
      const key = `${c.target_agent}|${point.severity}|${(point.claim_or_line || '').slice(0, 40)}`;
      if (!seen.has(key)) {
        novel++;
        seen.add(key);
      }
    }
  }
  return { novel, seen };
}

// Identify rubber‑stampers: those who always upvote without critiquing
function detectRubberStamp(voteJson, critJson) {
  const allHigh = (voteJson.scores || []).every(s => s.score >= 0.8);
  const noCrit = !(critJson.critiques || []).length;
  return allHigh && noCrit;
}

// Aggregate vote results: compute weighted averages and collect blocker issues and rater scores
function aggregateVotes(votes, agents, crits) {
  const weights = new Map(agents.map(a => [a.id, 1]));
  // Reduce weight for rubber‑stampers
  for (const v of votes) {
    const rubber = detectRubberStamp(v.res.json || {}, (crits.find(c => c.agentId === v.agentId) || {}).res?.json || {});
    if (rubber) weights.set(v.agentId, DELIB.weightPenaltyRubberStamp);
  }
  const scores = new Map();
  const counts = new Map();
  const blockers = new Map();
  const raterScores = new Map();
  for (const v of votes) {
    const rater = v.agentId;
    const weight = weights.get(rater) || 1;
    const json = v.res.json || {};
    for (const s of (json.scores || [])) {
      // accumulate weighted sum
      scores.set(s.agent_id, (scores.get(s.agent_id) || 0) + weight * s.score);
      counts.set(s.agent_id, (counts.get(s.agent_id) || 0) + weight);
      // record per rater for owner approvals
      let map = raterScores.get(s.agent_id);
      if (!map) {
        map = new Map();
        raterScores.set(s.agent_id, map);
      }
      const list = map.get(rater) || [];
      list.push(s.score);
      map.set(rater, list);
    }
    for (const b of (json.blocking_issues || [])) {
      const arr = blockers.get(b.agent_id) || [];
      arr.push(b.issue);
      blockers.set(b.agent_id, arr);
    }
  }
  // Compute averages
  const avg = Array.from(scores.entries()).map(([id, sum]) => {
    const c = counts.get(id) || 1;
    return { agentId: id, avg: sum / c, blockers: blockers.get(id) || [] };
  }).sort((a, b) => b.avg - a.avg);
  // Compress raterScores: average duplicates for same rater
  for (const [cand, m] of raterScores.entries()) {
    for (const [rater, arr] of m.entries()) {
      m.set(rater, arr.reduce((a, b) => a + b, 0) / arr.length);
    }
  }
  return { avg, weights, blockers, raterScores };
}

// Determine if consensus is reached given averages and mode
function consensusReached(avg, mode) {
  if (!avg.length) return null;
  const top = avg[0];
  // Blocker veto
  if (CONSENSUS.requireNoBlockers && top.blockers.length) return null;
  if (mode === 'unanimous') {
    const minAvg = avg[avg.length - 1]?.avg ?? 0;
    return minAvg >= CONSENSUS.unanimousPct ? top : null;
  }
  if (mode === 'super') {
    return top.avg >= CONSENSUS.superMajorityPct ? top : null;
  }
  // majority
  return top.avg >= CONSENSUS.majorityPct ? top : null;
}

// ----- Main execution ------------------------------------------------------
(async function main() {
  // Check for interactive mode - default when no question provided or explicit flag
  const hasQuestion = userQuestion && userQuestion.trim();
  const shouldUseInteractive = argv.includes('--interactive') || !hasQuestion;

  if (shouldUseInteractive) {
    const agents = loadAgents();

    const interactive = new InteractiveTerminal({
      logoRenderer: new LogoRenderer({ noColor: LOG.noColor }),
      commandParser: new CommandParser(),
      display: new TerminalDisplay({ noColor: LOG.noColor }),
      sessionManager: new SessionManager()
    });

    // Set up question handler to run orchestration
    interactive.setQuestionHandler(async (question, config) => {
      const agents = loadAgents();

      try {
        // Apply runtime configuration from interactive mode
        applyRuntimeConfig(config);

        // Run the full orchestration using the global LOGGER
        await runOrchestration(question, agents);
        return { success: true };
      } catch (error) {
        console.error('Orchestration failed:', error);
        return { success: false, error: error.message };
      }
    });

    // Load agents for interactive session
    interactive.sessionManager.setAgents(agents);

    await interactive.start();
    return;
  }

  // Non-interactive mode continues as before
  const agents = loadAgents();
  await runOrchestration(userQuestion, agents);
})(); // End of main async function

// Extract orchestration logic into reusable function
async function runOrchestration(userQuestion, agents) {
  // Reset interruption flag at the start
  global.orchestrationInterrupted = false;

  // Display session configuration
  LOGGER.blockTitle(`Session ${LOGGER.session} — ${agents.length} agents`);

  if (!LOG.quiet) {
    const presetInfo = presetName ? `preset=${presetName} | ` : '';
    console.log(paint(`Owners: ${OWNER.ids.length ? OWNER.ids.join(', ') : 'none'} | ownerMin=${OWNER.minScore} | ownerMode=${OWNER.mode}\n`, 'gray'));
    console.log(paint(`Consensus=${consensusMode} | thresholds: U=${CONSENSUS.unanimousPct} S=${CONSENSUS.superMajorityPct} M=${CONSENSUS.majorityPct} | blockers=${CONSENSUS.requireNoBlockers ? 'strict' : 'allowed'} | rubberPenalty=${DELIB.weightPenaltyRubberStamp}\n`, 'gray'));
  }
  // Log the question
  LOGGER.line({ id: 'orchestrator', avatar: '🗂️', displayName: 'Orchestrator', color: 'white' }, 'question', userQuestion);

  // Add separator after thinking phase

  // Round 0: initial proposals
  LOGGER.blockTitle('Initial Proposals ......');

  // Show agents are thinking about their proposals
  for (const agent of agents) {
    LOGGER.line(agent, 'thinking', 'Crafting my solution approach...');
  }

  // Add separator after thinking

  const r0 = await roundPropose(agents, userQuestion);

  // Check for interruption
  if (checkInterruption(null, 'boolean')) {
    return;
  }

  const okR0 = r0.filter(x => x.res && x.res.ok);
  if (!okR0.length) {
    console.error('No proposals received. Aborting.');
    process.exit(1);
  }
  // Prepare state: list of current proposals per agent
  let current = okR0.map(p => ({ agentId: p.agentId, payload: p.res.json }));
  // Set of seen critique pairs for novelty scoring
  let seenPairs = new Set();

  // Critique/vote rounds
  for (let round = 1; round <= maxRounds; round++) {
    LOGGER.blockTitle(`Round ${round}: critiques & voting`);

    // Show agents are thinking about critiques
    for (const agent of agents) {
      LOGGER.line(agent, 'thinking', 'Reviewing peer proposals...');
    }

    // Add separator after thinking

    // Critique phase
    const crits = await roundCritique(agents, userQuestion, current);

    // Check for interruption after critique
    if (checkInterruption(null, 'boolean')) {
      return;
    }

    const okCrits = crits.filter(x => x.res && x.res.ok);
    // Novelty check across all agents
    let totalNovel = 0;
    for (const c of okCrits) {
      const { novel, seen } = noveltyScore(c.res.json.critiques, seenPairs);
      totalNovel += novel;
      seenPairs = seen;
    }
    // Revision phase - agents update their proposals based on feedback
    for (const agent of agents) {
      LOGGER.line(agent, 'thinking', 'Considering peer feedback...');
    }

    // Add separator after thinking

    const revisions = await roundRevise(agents, userQuestion, current, okCrits);
    const okRevisions = revisions.filter(r => r.res && r.res.ok);

    // Apply revisions to current proposals
    for (const rev of okRevisions) {
      const revised = rev.res.json.revised;
      if (revised && revised.proposal && revised.proposal !== 'no change') {
        const idx = current.findIndex(x => x.agentId === rev.agentId);
        if (idx >= 0) current[idx].payload = revised;
      }
    }

    // Show agents are thinking about votes
    for (const agent of agents) {
      LOGGER.line(agent, 'thinking', 'Scoring all proposals...');
    }

    // Voting phase
    const votes = await roundVote(agents, userQuestion, current);
    const okVotes = votes.filter(v => v.res && v.res.ok);
    const { avg, raterScores } = aggregateVotes(okVotes, agents, okCrits);
    // Check consensus
    const winner = consensusReached(avg, consensusMode);
    if (winner) {
      // Owner approval enforcement, if configured
      if (OWNER.ids.length) {
        const orchestrator = { id: 'orchestrator', avatar: '🗂️', displayName: 'Orchestrator', color: 'gray' };
        const candId = winner.agentId;
        const raters = raterScores.get(candId) || new Map();
        const hits = OWNER.ids.filter(ownerId => (raters.get(ownerId) ?? -Infinity) >= OWNER.minScore);
        const ownersSatisfied = OWNER.mode === 'all' ? (hits.length === OWNER.ids.length) : (hits.length >= 1);

        if (!ownersSatisfied) {
          LOGGER.line(orchestrator, 'owner-reject', `Owner approval not satisfied for winner ${candId}. Required: ${OWNER.mode.toUpperCase()} of [${OWNER.ids.join(', ')}] with score ≥ ${OWNER.minScore}. Got approvals from [${hits.join(', ')}]. Continuing rounds...`);
          continue;
        }
        else {
          LOGGER.line(orchestrator, 'owner-approve', `Owner approval satisfied for winner ${candId}. Declaring consensus...`);
        }
      }
      // Consensus achieved
      const winnerPayload = current.find(c => c.agentId === winner.agentId)?.payload;

      LOGGER.line(orchestrator, 'consensus', `✅ CONSENSUS REACHED on ${winner.agentId} (avg=${winner.avg.toFixed(2)})`);
      LOGGER.line(orchestrator, 'final-answer', '===== FINAL ANSWER =====');
      LOGGER.line(orchestrator, 'proposal', winnerPayload.proposal || '(no proposal)');

      if (winnerPayload.code_patch) {
        LOGGER.line(orchestrator, 'code-patch', '--- code_patch (unified diff) ---');
        LOGGER.line(orchestrator, 'code-patch', winnerPayload.code_patch);
      }
      if (winnerPayload.tests && winnerPayload.tests.length) {
        LOGGER.line(orchestrator, 'tests', 'Tests to run:\n- ' + winnerPayload.tests.join('\n- '));
      }
      LOGGER.line(orchestrator, 'summary', 'Key points:\n- ' + (winnerPayload.key_points || []).join('\n- '));
      LOGGER.line(orchestrator, 'confidence', 'Confidence: ' + (winnerPayload.confidence || 'low'));
      LOGGER.line(orchestrator, 'final-answer', '========================');
      // Build scorecards summary
      const scorecards = agents.map(a => {
        const nov = okCrits.find(x => x.agentId === a.id)?.res.json?.critiques?.length || 0;
        const blk = okCrits.find(x => x.agentId === a.id)?.res.json?.critiques?.reduce((count, c) =>
          count + (c.points?.filter(p => p.severity === 'blocker').length || 0), 0) || 0;
        const isRubber = !okCrits.find(x => x.agentId === a.id) && okVotes.find(x => x.agentId === a.id);
        return {
          agentId: a.id,
          displayName: a.displayName,
          avatar: a.avatar,
          novelCritiques: nov,
          blockers: blk,
          rubber: isRubber,
          avgPeerScore: undefined, // could be filled via raterScores
        };
      });
      LOGGER.summary(scorecards);
      LOGGER.end();
      return;
    }
  }
  // No consensus reached within maxRounds; fallback to best candidate
  LOGGER.blockTitle('Max rounds reached — selecting highest scoring proposal');

  // Show agents are thinking about final votes
  for (const agent of agents) {
    LOGGER.line(agent, 'thinking', 'Making final evaluations...');
  }

  // Add separator after thinking

  // Recompute votes to show final ranking
  const finalVotes = await roundVote(agents, userQuestion, current);
  const okFinalVotes = finalVotes.filter(v => v.res && v.res.ok);
  const { avg: finalAvg } = aggregateVotes(okFinalVotes, agents, []);
  if (!finalAvg.length) {
    console.error('No votes tallied. Aborting.');
    return;
  }
  const top = finalAvg[0];
  const winnerPayload = current.find(c => c.agentId === top.agentId)?.payload;
  const orchestrator = { id: 'orchestrator', avatar: '🗂️', displayName: 'Orchestrator', color: 'white' };

  LOGGER.line(orchestrator, 'no-consensus', '⚖️  No consensus. Selecting highest scoring proposal.');
  LOGGER.line(orchestrator, 'final-answer', '===== FINAL (NO CONSENSUS) =====');
  LOGGER.line(orchestrator, 'proposal', winnerPayload.proposal || '(no proposal)');

  if (winnerPayload.code_patch) {
    LOGGER.line(orchestrator, 'code-patch', '--- code_patch (unified diff) ---');
    LOGGER.line(orchestrator, 'code-patch', winnerPayload.code_patch);
  }
  if (winnerPayload.tests && winnerPayload.tests.length) {
    LOGGER.line(orchestrator, 'tests', 'Tests to run:\n- ' + winnerPayload.tests.join('\n- '));
  }
  LOGGER.line(orchestrator, 'rankings', 'Rankings: ' + finalAvg.map(x => `${x.agentId}:${x.avg.toFixed(2)}`).join('  '));
  // Collect dissent notes from blockers map if available
  // (Simplified: could list issues but not computed here)
  LOGGER.line(orchestrator, 'final-answer', '===============================');
  // Build scorecards summary for fallback case (counts zero for critiques)
  const scorecards = agents.map(a => ({
    agentId: a.id,
    displayName: a.displayName,
    avatar: a.avatar,
    novelCritiques: 0,
    blockers: 0,
    rubber: false,
    avgPeerScore: undefined,
  }));
  LOGGER.summary(scorecards);
  LOGGER.end();
}
