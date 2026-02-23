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

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
// Additional imports to support file resolution and external helpers
import { fileURLToPath } from "node:url";
import { ANSI, ConversationLogger } from "./src/logger.js";
import { SessionManager } from "./src/session-manager.js";
import { BlessedInteractive } from "./src/blessed-interactive.js";
import { spawnAgentProcess } from "./src/agent-process.js";
import {
  runOrchestration,
  configureOrchestration,
} from "./src/orchestration.js";

// ----- Signal handling for graceful shutdown --------------------------------
const activeProcesses = new Set();

// Make activeProcesses globally accessible for interactive mode
global.activeProcesses = activeProcesses;

// Global flag to signal orchestration interruption
global.orchestrationInterrupted = false;

// Constant for interruption error message
const INTERRUPTION_ERROR = "Interrupted by user";

function gracefulShutdown(signal) {
  // Clean up blessed UI if active

  console.log(`\nReceived ${signal}. Terminating active processes...`);
  for (const child of activeProcesses) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// ----- CLI argument parsing -------------------------------------------------
const argv = process.argv.slice(2);

// Show config info if requested
if (argv.includes("--config")) {
  showConfigInfo();
  process.exit(0);
}

// Show help if requested
if (argv.includes("-h") || argv.includes("--help")) {
  const cwd = process.cwd();
  console.log(`⚔️  Excalibur CLI - Multi-agent orchestration with debate and consensus
📁 Working directory: ${cwd}

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
  --config              Show agent configuration info and file locations
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
const userQuestion = argv.find((a) => !a.startsWith("--"));
// Helpers to read numeric and string flags
function numFlag(name, def) {
  const v = (argv.find((a) => a.startsWith(`--${name}=`)) || "").split("=")[1];
  return v ? Number(v) : def;
}
function strFlag(name, def) {
  const v = (argv.find((a) => a.startsWith(`--${name}=`)) || "").split("=")[1];
  return v || def;
}

// Consensus mode (unanimous|super|majority); default super
let consensusMode = strFlag("consensus", "super");
// Maximum critique/vote rounds; default 5
let maxRounds = numFlag("maxRounds", 5);

// ----- Logging configuration -----------------------------------------------
const LOG = {
  dir: strFlag("logDir", "logs"),
  session: strFlag(
    "sessionTag",
    new Date().toISOString().replace(/[:.]/g, "-"),
  ),
  noColor: argv.includes("--no-color"),
  quiet: argv.includes("--quiet"),
};

// Legacy inline ANSI and ConversationLogger removed in favour of imported versions.

// Resolve this module's directory to locate prompt files
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load prompts from markdown files within the prompts directory
const PROMPT_DIR = path.join(__dirname, "prompts");
const PROMPTS = {
  propose: fs.readFileSync(path.join(PROMPT_DIR, "propose.md"), "utf8").trim(),
  critique: fs
    .readFileSync(path.join(PROMPT_DIR, "critique.md"), "utf8")
    .trim(),
  revise: fs.readFileSync(path.join(PROMPT_DIR, "revise.md"), "utf8").trim(),
  vote: fs.readFileSync(path.join(PROMPT_DIR, "vote.md"), "utf8").trim(),
};

// Colour wrapper helpers using imported ANSI and the noColor flag
const paint = (txt, colour) => ANSI.paint(txt, colour, LOG.noColor);

// Global conversation logger instantiation with colour and quiet options
const LOGGER = new ConversationLogger(LOG.dir, LOG.session, {
  noColor: LOG.noColor,
  quiet: LOG.quiet,
});

// ----- Orchestration parameters -------------------------------------------
// Debate/critique heuristics
const DELIB = {
  minNovelCritiquesPerRound: 1,
  requireMajorOrBlockerWhenWarranted: true,
  blockerSeverity: "blocker",
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
  strict: {
    unanimousPct: 0.85,
    superMajorityPct: 0.8,
    majorityPct: 0.6,
    requireNoBlockers: true,
    rubberPenalty: 0.35,
  },
  default: {
    unanimousPct: 0.75,
    superMajorityPct: 0.75,
    majorityPct: 0.5,
    requireNoBlockers: true,
    rubberPenalty: 0.5,
  },
  fast: {
    unanimousPct: 0.7,
    superMajorityPct: 0.66,
    majorityPct: 0.5,
    requireNoBlockers: false,
    rubberPenalty: 0.6,
  },
  experiment: {
    unanimousPct: 0.6,
    superMajorityPct: 0.6,
    majorityPct: 0.5,
    requireNoBlockers: false,
    rubberPenalty: 0.7,
  },
  team: {
    unanimousPct: 0.8,
    superMajorityPct: 0.75,
    majorityPct: 0.55,
    requireNoBlockers: true,
    rubberPenalty: 0.35,
  },
};
// Apply preset if specified
const presetName = strFlag("preset", "");
if (presetName && PRESETS[presetName]) {
  const p = PRESETS[presetName];
  CONSENSUS.unanimousPct = p.unanimousPct;
  CONSENSUS.superMajorityPct = p.superMajorityPct;
  CONSENSUS.majorityPct = p.majorityPct;
  CONSENSUS.requireNoBlockers = p.requireNoBlockers;
  DELIB.weightPenaltyRubberStamp = p.rubberPenalty;
}

// Override consensus thresholds and penalties via flags
CONSENSUS.unanimousPct = numFlag("unanimousPct", CONSENSUS.unanimousPct);
CONSENSUS.superMajorityPct = numFlag(
  "superMajorityPct",
  CONSENSUS.superMajorityPct,
);
CONSENSUS.majorityPct = numFlag("majorityPct", CONSENSUS.majorityPct);
DELIB.weightPenaltyRubberStamp = numFlag(
  "rubberPenalty",
  DELIB.weightPenaltyRubberStamp,
);
// allow-blockers flag disables requireNoBlockers
if (argv.includes("--allow-blockers")) {
  CONSENSUS.requireNoBlockers = false;
}

// Owner approval flags
const OWNER = {
  ids: strFlag("owner", "").trim()
    ? strFlag("owner", "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [],
  minScore: numFlag("ownerMin", 0.8),
  mode: strFlag("ownerMode", "any") === "all" ? "all" : "any",
};

/**
 * Build comprehensive scorecards for all agents
 * @param {Array} agents - Array of agent objects
 * @param {Array} okCrits - Valid critique responses
 * @param {Array} okVotes - Valid vote responses
 * @param {Map} raterScores - Map of agent scores
 * @param {Array} avg - Final consensus averages
 * @returns {Array} Array of scorecard objects
 */
function buildScorecards(agents, okCrits, okVotes, raterScores, avg) {
  return agents.map((a) => {
    // Critique analysis
    const critResponse = okCrits.find((x) => x.agentId === a.id);
    const novelCritiques = critResponse?.res.json?.critiques?.length || 0;
    const blockerCount =
      critResponse?.res.json?.critiques?.reduce(
        (count, c) =>
          count +
          (c.points?.filter((p) => p.severity === "blocker").length || 0),
        0,
      ) || 0;

    // Voting analysis
    const voteResponse = okVotes.find((x) => x.agentId === a.id);
    const participated = {
      critique: !!critResponse,
      vote: !!voteResponse,
    };

    // Rubber stamp detection (voted without critiquing)
    const isRubberStamp = !critResponse && !!voteResponse;

    // Peer scoring analysis
    const agentRaters = raterScores.get(a.id) || new Map();
    const peerScores = Array.from(agentRaters.values()).filter(
      (score) => score !== -Infinity,
    );
    const avgPeerScore =
      peerScores.length > 0
        ? peerScores.reduce((sum, score) => sum + score, 0) / peerScores.length
        : null;

    // Final proposal score in the consensus ranking
    const finalRanking = avg.findIndex((entry) => entry.agentId === a.id) + 1;
    const finalScore = avg.find((entry) => entry.agentId === a.id)?.avg || null;

    return {
      agentId: a.id,
      displayName: a.displayName,
      avatar: a.avatar,
      novelCritiques,
      blockerCount,
      isRubberStamp,
      participated,
      avgPeerScore: avgPeerScore ? parseFloat(avgPeerScore.toFixed(3)) : null,
      finalScore: finalScore ? parseFloat(finalScore.toFixed(3)) : null,
      finalRanking: finalRanking <= avg.length ? finalRanking : null,
      peerVoteCount: peerScores.length,
    };
  });
}

/**
 * Build proposal sections (code, tests, key points, confidence)
 * @param {Object} payload - Proposal payload
 * @param {boolean} includeMetrics - Whether to include confidence and key points
 * @returns {Array} Array of result lines
 */
function buildProposalSections(payload, includeMetrics = true) {
  const sections = [];

  sections.push(payload.proposal || "(no proposal)");

  if (payload.code_patch) {
    sections.push("");
    sections.push("--- code_patch (unified diff) ---");
    sections.push(payload.code_patch);
  }

  if (payload.tests && payload.tests.length) {
    sections.push("");
    sections.push("Tests to run:");
    payload.tests.forEach((test) => sections.push(`- ${test}`));
  }

  if (includeMetrics) {
    if (payload.key_points && payload.key_points.length) {
      sections.push("");
      sections.push("Key points:");
      payload.key_points.forEach((point) => sections.push(`- ${point}`));
    }

    sections.push("");
    sections.push(`Confidence: ${payload.confidence || "low"}`);
  }

  return sections;
}

/**
 * Build formatted result message
 * @param {Object} options - Configuration object
 * @param {string} options.header - Header message
 * @param {string} options.title - Title section
 * @param {Object} options.payload - Winner's proposal payload
 * @param {string} options.footer - Footer section
 * @param {Array} [options.rankings] - Final rankings array
 * @param {boolean} [options.includeMetrics=true] - Include confidence and key points
 * @returns {string} Complete formatted result message
 */
function buildResultMessage({
  header,
  title,
  payload,
  footer,
  rankings,
  includeMetrics = true,
}) {
  const result = [];

  result.push(header);
  result.push("");
  result.push(title);
  result.push("");

  result.push(...buildProposalSections(payload, includeMetrics));

  if (rankings) {
    result.push("");
    result.push(
      "Rankings: " +
        rankings.map((x) => `${x.agentId}:${x.avg.toFixed(2)}`).join("  "),
    );
  }

  result.push("");
  result.push(footer);

  return result.join("\n");
}

/**
 * Build formatted final result message
 * @param {Object} winner - Winner object with agentId and avg
 * @param {Object} winnerPayload - Winner's proposal payload
 * @returns {string} Complete final result message
 */
function buildFinalResult(winner, winnerPayload) {
  return buildResultMessage({
    header: `✅ CONSENSUS REACHED on ${winner.agentId} (avg=${winner.avg.toFixed(2)})`,
    title: "===== FINAL ANSWER =====",
    payload: winnerPayload,
    footer: "========================",
  });
}

/**
 * Build formatted no-consensus result message
 * @param {Object} winnerPayload - Top candidate's proposal payload
 * @param {Array} finalAvg - Final average scores array
 * @returns {string} Complete no-consensus result message
 */
function buildNoConsensusResult(winnerPayload, finalAvg) {
  return buildResultMessage({
    header: "⚖️  No consensus. Selecting highest scoring proposal.",
    title: "===== FINAL (NO CONSENSUS) =====",
    payload: winnerPayload,
    footer: "===============================",
    rankings: finalAvg,
    includeMetrics: false,
  });
}

/**
 * Complete orchestration session with result logging and scorecards
 * @param {Object} orchestrator - Orchestrator agent object
 * @param {string} resultMessage - Final result message to log
 * @param {string} logPhase - Log phase for the result message
 * @param {Array} agents - Array of agent objects
 * @param {Array} okCrits - Valid critique responses
 * @param {Array} okVotes - Valid vote responses
 * @param {Map} raterScores - Map of agent scores
 * @param {Array} avg - Final consensus averages
 */
function completeOrchestration(
  orchestrator,
  resultMessage,
  logPhase,
  agents,
  okCrits,
  okVotes,
  raterScores,
  avg,
) {
  LOGGER.line(orchestrator, logPhase, resultMessage);
  const scorecards = buildScorecards(
    agents,
    okCrits,
    okVotes,
    raterScores,
    avg,
  );
  LOGGER.summary(scorecards);
  LOGGER.end();
}

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
  if (typeof config.maxRounds === "number") {
    maxRounds = config.maxRounds;
  }

  // Consensus thresholds
  if (typeof config.unanimousPct === "number") {
    CONSENSUS.unanimousPct = config.unanimousPct;
  }
  if (typeof config.superMajorityPct === "number") {
    CONSENSUS.superMajorityPct = config.superMajorityPct;
  }
  if (typeof config.majorityPct === "number") {
    CONSENSUS.majorityPct = config.majorityPct;
  }

  // Behavioral controls
  if (typeof config.allowBlockers === "boolean") {
    CONSENSUS.requireNoBlockers = !config.allowBlockers;
  }
  if (typeof config.rubberPenalty === "number") {
    DELIB.weightPenaltyRubberStamp = config.rubberPenalty;
  }

  // Owner approval settings
  if (config.owner && Array.isArray(config.owner)) {
    OWNER.ids = config.owner;
  }
  if (typeof config.ownerMin === "number") {
    OWNER.minScore = config.ownerMin;
  }
  if (config.ownerMode) {
    OWNER.mode = config.ownerMode === "all" ? "all" : "any";
  }

  // Logging settings (note: these affect the global LOG object)
  if (config.logDir) {
    LOG.dir = config.logDir;
  }
  if (config.sessionTag) {
    LOG.session = config.sessionTag;
  }
  if (typeof config.quiet === "boolean") {
    LOG.quiet = config.quiet;
  }
  if (typeof config.noColor === "boolean") {
    LOG.noColor = config.noColor;
  }
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
    if (!agent.id || typeof agent.id !== "string") {
      errors.push(`${prefix}: missing or invalid 'id' field`);
    }
    if (!agent.displayName || typeof agent.displayName !== "string") {
      errors.push(`${prefix}: missing or invalid 'displayName' field`);
    }
    if (!agent.cmd || typeof agent.cmd !== "string") {
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
    if (
      Array.isArray(agent.args) &&
      !agent.args.some((arg) => arg.includes("{PROMPT}"))
    ) {
      errors.push(
        `${prefix}: 'args' array must contain '{PROMPT}' placeholder`,
      );
    }

    // Validate optional numeric fields
    if (
      agent.timeoutMs !== undefined &&
      (!Number.isInteger(agent.timeoutMs) || agent.timeoutMs <= 0)
    ) {
      errors.push(`${prefix}: 'timeoutMs' must be a positive integer`);
    }

    // Validate optional string fields
    if (
      agent.inputMode !== undefined &&
      !["arg", "stdin"].includes(agent.inputMode)
    ) {
      errors.push(`${prefix}: 'inputMode' must be 'arg' or 'stdin'`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`agents.json validation failed:\n  ${errors.join("\n  ")}`);
  }
}

// Get standard config file paths (Single Responsibility)
function getConfigPaths() {
  return {
    userConfig: path.join(os.homedir(), ".excalibur", "agents.json"),
    cwdConfig: path.join(process.cwd(), "agents.json"),
    packageConfig: path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "agents.json",
    ),
  };
}

// Show configuration information (Interface Segregation)
function showConfigInfo() {
  const paths = getConfigPaths();
  const currentConfig = (() => {
    try {
      return resolveConfigPath();
    } catch {
      return "None found";
    }
  })();

  console.log(`⚔️  Excalibur Configuration

AGENTS CONFIG LOCATIONS (priority order):
  1. ~/.excalibur/agents.json     ${fs.existsSync(paths.userConfig) ? "✅ Found" : "❌ Not found"}
  2. ./agents.json (current dir)  ${fs.existsSync(paths.cwdConfig) ? "✅ Found" : "❌ Not found"}
  3. Package directory            ${fs.existsSync(paths.packageConfig) ? "✅ Found" : "❌ Not found"}

TO CONFIGURE AGENTS:
  1. Edit ~/.excalibur/agents.json with your preferred agents
  2. Or create ./agents.json in your project directory
  3. Each agent needs: id, displayName, cmd, args, inputMode

EXAMPLE:
  [
    {
      "id": "claude",
      "displayName": "Claude CLI",
      "cmd": "claude",
      "args": ["-p", "{PROMPT}"],
      "inputMode": "arg"
    }
  ]

Current config: ${currentConfig}
`);
}

// Resolve which config file to use (Single Responsibility)
function resolveConfigPath() {
  const paths = getConfigPaths();

  if (fs.existsSync(paths.userConfig)) {
    return paths.userConfig;
  }

  if (fs.existsSync(paths.cwdConfig)) {
    return paths.cwdConfig;
  }

  if (fs.existsSync(paths.packageConfig)) {
    // Copy default to user directory for future editing (Open/Closed Principle)
    try {
      const userConfigDir = path.dirname(paths.userConfig);
      fs.mkdirSync(userConfigDir, { recursive: true });
      fs.copyFileSync(paths.packageConfig, paths.userConfig);
      console.log("✅ Created editable config at ~/.excalibur/agents.json");
    } catch (e) {
      // Ignore copy errors (might not have write permissions)
    }
    return paths.packageConfig;
  }

  throw new Error(
    "Missing agents.json - could not find in ~/.excalibur/, current directory, or package directory",
  );
}

// Load agents from agents.json, assigning default avatars/colours if missing
function loadAgents() {
  const agentsPath = resolveConfigPath();

  const list = JSON.parse(fs.readFileSync(agentsPath, "utf8"));
  if (!Array.isArray(list) || list.length === 0)
    throw new Error("agents.json has no agents");

  // Validate the configuration
  validateAgents(list);

  return list.map((cfg) => ({
    avatar: cfg.avatar || "🤖",
    color: cfg.color || "white",
    ...cfg,
  }));
}

(async function main() {
  // Check for interactive mode - default when no question provided or explicit flag
  const hasQuestion = userQuestion && userQuestion.trim();
  const shouldUseInteractive = argv.includes("--interactive") || !hasQuestion;

  if (shouldUseInteractive) {
    await runInteractiveMode();
    return;
  }

  await runNonInteractiveMode(userQuestion);
})(); // End of main async function

async function runInteractiveMode() {
  const agents = loadAgents();

  const interactive = new BlessedInteractive({
    sessionManager: new SessionManager(),
    logger: LOGGER,
  });

  interactive.setQuestionHandler(async (question, config) => {
    return runOrchestrationWithErrorHandling(question, config);
  });

  interactive.sessionManager.setAgents(agents);
  await interactive.start();
}

async function runNonInteractiveMode(question) {
  const agents = loadAgents();

  configureOrchestration({
    logger: LOGGER,
    prompts: PROMPTS,
    consensus: CONSENSUS,
    delib: DELIB,
    owner: OWNER,
    consensusMode,
    maxRounds,
    activeProcesses,
  });

  try {
    await runOrchestration(question, agents, paint);
  } catch (error) {
    handleOrchestrationError(error);
  }
}

async function runOrchestrationWithErrorHandling(question, config = {}) {
  const agents = loadAgents();

  try {
    // Apply runtime configuration from interactive mode
    applyRuntimeConfig(config);

    // Configure orchestration module
    configureOrchestration({
      logger: LOGGER,
      prompts: PROMPTS,
      consensus: CONSENSUS,
      delib: DELIB,
      owner: OWNER,
      consensusMode,
      maxRounds,
      activeProcesses,
    });

    // Run the full orchestration using the global LOGGER
    const finalAnswer = await runOrchestration(question, agents, paint);
    return { success: true, finalAnswer };
  } catch (error) {
    handleOrchestrationError(error);
    return { success: false, error: error.message };
  }
}

function handleOrchestrationError(error) {
  console.error("Orchestration failed:", error.message);
  if (LOGGER) {
    LOGGER.line(
      { id: "orchestrator", displayName: "Orchestrator", color: "red" },
      "error",
      `Orchestration failed: ${error.message}`,
    );
  }
  process.exit(1);
}
