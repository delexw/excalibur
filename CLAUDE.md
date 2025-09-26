# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **Round Table Knights CLI** (圆桌骑士 CLI), a multi-agent orchestration engine that coordinates AI model CLIs in structured debates to reach consensus on solutions. The system implements a proposal → critique → vote cycle with configurable consensus thresholds.

## Architecture

### Core Components

- **index.js**: Main orchestration engine that manages the debate lifecycle, consensus logic, and agent coordination
- **logger.js**: Contains `ConversationLogger` class with ANSI color support for per-agent logging and consolidated transcripts
- **agents.json**: Configuration file defining available agents (Claude, Gemini, Cursor, Codex) with their CLI commands, timeouts, and display settings
- **prompts/**: Directory containing Markdown templates for different debate phases:
  - `propose.md`: Instructions for initial solution proposals
  - `critique.md`: Guidelines for peer critique and revision
  - `vote.md`: Voting instructions and scoring criteria

### Key Architecture Patterns

- **Agent Abstraction**: Each agent is defined with `cmd`, `args`, `inputMode` (stdin/arg), and timeout configuration
- **Consensus Mechanisms**: Three modes (unanimous, super-majority, majority) with configurable thresholds
- **Rubber-Stamp Detection**: Agents that provide low-effort critiques have their votes weighted down
- **Owner Approval**: Optional requirement for specific agents to approve final solutions above minimum scores

## Running the Application

### Basic Usage
```bash
node index.js "Your question here" [flags]
```

### Common Commands
```bash
# Run with team preset and super-majority consensus
node index.js "Explain how to stream large CSVs into Postgres safely." --preset=team --consensus=super --maxRounds=5

# Run with strict consensus requiring unanimous approval
node index.js "Your question" --preset=strict --consensus=unanimous --maxRounds=3

# Run with custom thresholds and owner approval
node index.js "Your question" --superMajorityPct=0.8 --owner=claude,gemini --ownerMin=0.85
```

### Available Presets
- `strict`: High consensus thresholds, penalties for rubber-stamping
- `team`: Balanced settings for collaborative decision-making
- `fast`: Lower thresholds for quicker consensus
- `experiment`: Experimental settings for testing
- `default`: Standard configuration

## Development

### Testing
No formal test suite exists. Testing is done by running the orchestrator with different questions and configurations.

### Customizing Agents
Edit `agents.json` to:
- Add new AI model CLIs
- Modify command-line arguments and input modes
- Adjust timeouts and display settings
- Configure avatars and colors for logging

### Customizing Prompts
The debate instructions are in `prompts/*.md` files:
- Use Markdown formatting for clear structure
- Include JSON schemas for expected response formats
- Modify rules and scoring criteria without touching JavaScript code

### Logging
- Session logs are written to `logs/` directory by default
- Each agent gets individual log files
- Consolidated transcript with scorecards generated after each run
- Use `--logDir` to specify custom log directory
- Use `--sessionTag` for custom session identification

## Technical Requirements

- Node.js ≥ 18 (for ECMAScript modules and `import` syntax)
- Each agent CLI must be installed and runnable on the system
- No external dependencies - uses only built-in Node modules

## Key Features

- **Multi-round Debates**: Configurable rounds of critique and voting until consensus
- **Consensus Flexibility**: Three consensus modes with customizable thresholds
- **Quality Control**: Rubber-stamp penalty system and optional owner approval
- **Comprehensive Logging**: Detailed per-agent logs and human-readable transcripts
- **CLI Integration**: Supports various AI model CLIs through configurable command execution