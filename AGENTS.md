# AGENTS.md

This file provides guidance for agentic coding agents working in this repository.

## Project Overview

**Round Table Knights CLI** (Excalibur) is a multi-agent orchestration engine that coordinates AI model CLIs in structured debates to reach consensus. The system implements a proposal → critique → vote cycle with configurable consensus thresholds.

## Running the Application

```bash
# Run in direct mode with a question
node index.js "Your question here" [flags]

# Run in interactive mode
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

## Development Commands

```bash
# Type check the project
npm run typecheck

# Build TypeScript to JavaScript
npm run build

# Run the application in development mode
npm start -- "Your question"
```

### Testing

No formal test suite exists. Testing is done manually:

```bash
# Run with different configurations
node index.js "Your question" --preset=team --consensus=super
node index.js "Your question" --preset=strict --consensus=unanimous --maxRounds=3
```

## Code Style Guidelines

### General Principles

- Use ES Modules (import/export syntax)
- Target Node.js ≥ 18
- Use TypeScript for all source files
- Single quotes for strings, no semicolons
- Keep functions focused and single-purpose

### TypeScript

- Use interfaces for all types (see `src/types.ts` for examples)
- Use `type` for unions, aliases, and primitives
- Use `import type` for type-only imports
- Always define return types for functions
- Avoid `any` - use `unknown` when type is uncertain

### Imports

```typescript
// Node.js built-in modules - use node: prefix
import fs from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';

// Local modules - include .js extension
import { ANSI, ConversationLogger } from './logger.js';
import type { Agent, Orchestrator } from './types.js';
```

### Naming Conventions

- **Files**: kebab-case (e.g., `agent-process.ts`, `session-manager.ts`)
- **Classes/Interfaces/Types**: PascalCase (e.g., `ConversationLogger`, `Agent`)
- **Functions**: camelCase (e.g., `spawnProcess`, `runOrchestration`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `INTERRUPTION_ERROR`)
- **Configuration keys**: camelCase in JSON

### JSDoc Comments

Use JSDoc for public APIs and complex functions:

```typescript
/**
 * Multi‑agent orchestration CLI with debate, critique, voting and consensus.
 *
 * @param question - The question to ask the agents
 * @param options - Configuration options
 * @returns The final consensus result
 */
async function runOrchestration(question: string, options: Options): Promise<Result> {
  // implementation
}
```

### Error Handling

- Use descriptive error messages
- Handle process signals for graceful shutdown (SIGINT, SIGTERM)
- Use ProcessManager for tracking active processes
- Use custom error constants for specific error types

```typescript
const INTERRUPTION_ERROR = 'Interrupted by user';
const processManager = getProcessManager();

function gracefulShutdown(signal: string): void {
  console.log(`\nReceived ${signal}. Terminating...`);
  processManager.killAll('SIGTERM');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
```

### File Organization

- Entry point: `index.ts`
- Source files: `src/` directory
- Types: `src/types.ts`
- Logger: `src/logger.ts`
- Session management: `src/session-manager.ts`
- Process management: `src/process-manager.ts`
- Orchestration: `src/orchestration.ts`
- Interactive UI: `src/blessed-interactive.ts`
- Configuration: `agents.json`
- Prompts: `prompts/*.md`

### Configuration Files

- **agents.json**: Define agents with `cmd`, `args`, `inputMode`, `timeout`, `avatar`, `color`
- **prompts/*.md**: Use Markdown formatting, include JSON schemas for expected responses

### Logging

- Use `ConversationLogger` class from `logger.ts` for per-agent logging
- Support ANSI colors via the `ANSI` object
- Write session logs to configurable `logs/` directory

## Architecture Patterns

1. **Agent Abstraction**: Each agent defined with `cmd`, `args`, `inputMode`, and `timeout`
2. **Consensus Mechanisms**: Three modes (unanimous, super-majority, majority) with configurable thresholds
3. **Rubber-Stamp Detection**: Weight down votes from agents providing low-effort critiques
4. **Owner Approval**: Optional requirement for specific agents to approve final solutions
