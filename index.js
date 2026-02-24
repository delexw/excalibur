#!/usr/bin/env node
/**
 * Multi‑agent orchestration CLI with debate, critique, voting and consensus.
 */

import fs from "node:fs";
import { ConversationLogger } from "./src/logger.js";
import { SessionManager } from "./src/session-manager.js";
import { BlessedInteractive } from "./src/blessed-interactive.js";
import { DirectRunner } from "./src/direct-runner.js";
import { getProcessManager } from "./src/process-manager.js";
import { Config } from "./src/config.js";

// ----- Signal handling for graceful shutdown --------------------------------
const processManager = getProcessManager();
global.processManager = processManager;
global.orchestrationInterrupted = false;

function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}. Terminating active processes...`);
  processManager.killAll('SIGTERM');
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// ----- Initialize configuration ---------------------------------------------
const config = new Config();

if (config.hasFlag("--config")) {
  const info = config.getConfigInfo();
  console.log(`⚔️  Excalibur Configuration

AGENTS CONFIG LOCATIONS (priority order):
 1. ~/.excalibur/agents.json     ${fs.existsSync(info.paths.userConfig) ? "✅ Found" : "❌ Not found"}
 2. ./agents.json (current dir)  ${fs.existsSync(info.paths.cwdConfig) ? "✅ Found" : "❌ Not found"}
 3. Package directory            ${fs.existsSync(info.paths.packageConfig) ? "✅ Found" : "❌ Not found"}

Current config: ${info.currentConfig}
`);
  process.exit(0);
}

if (config.hasFlag("-h") || config.hasFlag("--help")) {
  console.log(`⚔️  Excalibur CLI - Multi-agent orchestration with debate and consensus
📁 Working directory: ${process.cwd()}

USAGE:
  excalibur                          (interactive mode - default)
  excalibur "Your question" [options] (direct mode)

OPTIONS:
  --maxRounds=N         Maximum rounds (default: 5)
  --consensus=MODE      Consensus mode: unanimous|super|majority (default: super)
  --preset=NAME         Apply preset: strict|default|fast|experiment|team
  --unanimousPct=X      Override unanimous threshold (default: 0.75)
  --superMajorityPct=X  Override super majority threshold (default: 0.75)
  --majorityPct=X       Override majority threshold (default: 0.5)
  --responseThreshold=X Response threshold (default: 0.8)
  --allow-blockers      Allow consensus with blockers
  --rubberPenalty=X     Rubber-stamping penalty (default: 0.5)
  --owner=ID1,ID2,...  Require owner approval
  --ownerMin=X          Owner min score (default: 0.8)
  --ownerMode=any|all   Owner mode (default: any)
  --logDir=DIR          Log directory (default: "logs")
  --sessionTag=TAG       Session tag
  --quiet               Suppress console output
  --no-color            Disable colors
  --interactive          Force interactive mode
  --config              Show config info
  -h, --help            Show this help
`);
  process.exit(0);
}

// ----- Initialize logger ----------------------------------------------------
const agents = config.getAgents();
const LOGGER = new ConversationLogger(
  config.get('log.dir'),
  config.get('log.session'),
  {
    noColor: config.get('log.noColor'),
    quiet: config.get('log.quiet'),
    agents,
  }
);

// ----- Main -----------------------------------------------------------------
(async function main() {
  const hasQuestion = config.getQuestion()?.trim();
  const shouldUseInteractive = config.hasFlag("--interactive") || !hasQuestion;

  if (shouldUseInteractive) {
    await runInteractiveMode();
  } else {
    await runDirectMode(hasQuestion);
  }
})();

async function runInteractiveMode() {
  const interactive = new BlessedInteractive({
    sessionManager: new SessionManager({ agents }),
    logger: LOGGER,
    processManager,
    agents,
    config: config.settings,
  });

  await interactive.start();
}

async function runDirectMode(question) {
  const runner = new DirectRunner({
    logger: LOGGER,
    processManager,
    agents,
    config: config.settings,
  });

  await runner.run(question);
}
