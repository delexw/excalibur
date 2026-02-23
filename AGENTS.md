# AGENTS.md

This file provides guidance for agentic coding agents working in this repository.

## Project Overview

This is **Round Table Knights CLI** (Excalibur), a multi-agent orchestration engine that coordinates AI model CLIs in structured debates to reach consensus. The system implements a proposal → critique → vote cycle with configurable consensus thresholds.

## Running the Application

### Basic Commands

```bash
# Run in direct mode with a question
node index.js "Your question here" [flags]

# Run in interactive mode (default when no question provided)
node index.js
```

### Common Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--maxRounds=N` | Maximum critique/vote cycles | 5 |
| `--consensus=MODE` | unanimous, super, or majority | super |
| `--preset=NAME` | strict, default, fast, experiment, team | default |
| `--quiet` | Suppress console logs | false |
| `--no-color` | Disable ANSI color output | false |
| `--logDir=DIR` | Directory for session logs | logs/ |
| `--sessionTag=TAG` | Custom tag for session | - |

### Presets

- **strict**: High consensus thresholds, penalties for rubber-stamping
- **team**: Balanced settings for collaborative decision-making
- **fast**: Lower thresholds for quicker consensus
- **experiment**: Experimental settings for testing
- **default**: Standard configuration

## Development

### Testing

No formal test suite exists. Testing is done manually by running the orchestrator with different questions and configurations:

```bash
# Test with different questions
node index.js "Explain how to stream large CSVs into Postgres safely." --preset=team --consensus=super

# Test with strict consensus
node index.js "Your question" --preset=strict --consensus=unanimous --maxRounds=3

# Test with custom thresholds
node index.js "Your question" --superMajorityPct=0.8 --owner=claude --ownerMin=0.85
```

### Linting

No linting configuration exists. Code should follow the style guidelines below.

## Code Style Guidelines

### General Principles

- Use ES Modules (import/export syntax)
- Target Node.js ≥ 18
- No external dependencies - use only built-in Node modules
- Keep functions focused and single-purpose
- Use meaningful variable and function names

### Imports

```javascript
// Node.js built-in modules
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Local modules (use .js extension)
import { ANSI, ConversationLogger } from './logger.js';
import { SessionManager } from './session-manager.js';
```

### File Organization

- Main entry point: `index.js`
- Logger: `logger.js`
- Session management: `session-manager.js`
- Agent process spawning: `agent-process.js`
- Orchestration logic: `orchestration.js`
- Interactive UI: `blessed-interactive.js`
- Configuration: `agents.json`
- Prompts: `prompts/*.md`

### Naming Conventions

- **Files**: kebab-case (e.g., `agent-process.js`, `session-manager.js`)
- **Classes**: PascalCase (e.g., `ConversationLogger`, `SessionManager`)
- **Functions**: camelCase (e.g., `spawnAgentProcess`, `runOrchestration`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `INTERRUPTION_ERROR`)
- **Configuration keys**: camelCase in JSON

### JSDoc Comments

Use JSDoc for public APIs and complex functions:

```javascript
/**
 * Multi‑agent orchestration CLI with debate, critique, voting and consensus.
 *
 * @param {string} question - The question to ask the agents
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} The final consensus result
 */
async function runOrchestration(question, options) {
  // implementation
}
```

### Error Handling

- Use descriptive error messages
- Handle process signals for graceful shutdown (SIGINT, SIGTERM)
- Track active processes in a Set for cleanup
- Use custom error constants for specific error types

```javascript
const INTERRUPTION_ERROR = 'Interrupted by user';

// Handle graceful shutdown
const activeProcesses = new Set();

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
```

### CLI Argument Parsing

Parse arguments from `process.argv.slice(2)`:

```javascript
const argv = process.argv.slice(2);

// Check for flags
if (argv.includes('--help') || argv.includes('-h')) {
  // Show help
}
```

### Configuration Files

- **agents.json**: Define agents with `cmd`, `args`, `inputMode`, `timeout`, `avatar`, `color`
- **prompts/*.md**: Use Markdown formatting, include JSON schemas for expected responses
- **CLAUDE.md**: Project documentation for Claude Code

### Logging

- Use `ConversationLogger` class from `logger.js` for per-agent logging
- Support ANSI colors via the `ANSI` object
- Write session logs to configurable `logs/` directory
- Generate consolidated transcripts with scorecards

### Global State

When needed, attach to `global` object:

```javascript
global.activeProcesses = activeProcesses;
global.orchestrationInterrupted = false;
```

## Key Architecture Patterns

1. **Agent Abstraction**: Each agent defined with `cmd`, `args`, `inputMode`, and `timeout`
2. **Consensus Mechanisms**: Three modes (unanimous, super-majority, majority) with configurable thresholds
3. **Rubber-Stamp Detection**: Weight down votes from agents providing low-effort critiques
4. **Owner Approval**: Optional requirement for specific agents to approve final solutions

## Modifying Prompts

Edit files in `prompts/` directory:
- `propose.md`: Solution proposal instructions
- `critique.md`: Peer critique guidelines
- `vote.md`: Voting instructions and scoring criteria

Use Markdown formatting and include JSON schemas for expected response formats.
