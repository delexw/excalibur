# ⚔️ Excalibur CLI (圆桌骑士 CLI)

**Excalibur CLI** (Chinese: **圆桌骑士 CLI**) coordinates a panel of agents like the legendary knights at a round table.  It provides a multi‑agent orchestration engine with debate, critique, voting and consensus.

This project contains a Node.js script that orchestrates multiple AI model CLI processes into a structured debate.  It can be used to run several language model backends (e.g. Claude, Gemini, Cursor, Codex) against a single question, let them propose solutions, critique each other, vote and synthesise a final answer.

## Features

- **Proposal → Critique → Vote Cycles** — each agent first proposes a solution, then critiques peers and optionally revises, then votes on the best proposal.  Multiple rounds of critique/voting can be run until consensus is reached.
- **Configurable Consensus Modes** — choose between `unanimous`, `super` or `majority` consensus.  Thresholds (e.g. 75 % super‑majority) can be tweaked via flags.
- **Presets** — built‑in presets such as `team`, `strict`, `fast` configure sensible defaults for consensus thresholds and rubber‑stamping penalties.
- **Owner Approval** — optionally require specific agent(s) to approve the winning proposal above a minimum score before acceptance.
- **Rubber‑Stamp Penalty** — agents that always upvote without providing critiques have their votes weighted down.
- **Logging and Transcripts** — all prompts and responses are logged per‑agent with emoji avatars and colour tags.  A human‑readable transcript with scorecards is written under the `logs/` directory after each run.

## Requirements

- Node.js ≥ 18 (for ECMAScript modules and `import` syntax)
- Each agent CLI you wish to orchestrate must be installed and runnable on your system.  The sample `agents.json` file includes four placeholder definitions for **Claude**, **Gemini**, **Cursor** and **Codex**; adjust `cmd`/`args` to suit your local executables.

## Usage

Run the CLI:

```bash
excalibur "Explain how to stream large CSVs into Postgres safely." --preset=team --consensus=super --maxRounds=5
```

Or if running directly:

```bash
node index.js "Explain how to stream large CSVs into Postgres safely." --preset=team --consensus=super --maxRounds=5
```

### Common flags

| Flag | Description |
| --- | --- |
| `--maxRounds=N` | Maximum critique/vote cycles (default 5) |
| `--consensus=MODE` | `unanimous`, `super` or `majority` (default `super`) |
| `--preset=NAME` | Apply preset: `strict`, `default`, `fast`, `experiment`, `team` |
| `--unanimousPct=X` | Override unanimous threshold (0–1) |
| `--superMajorityPct=X` | Override super majority threshold |
| `--majorityPct=X` | Override majority threshold |
| `--allow-blockers` | Allow consensus even if blockers remain |
| `--rubberPenalty=X` | Weight for rubber‑stampers (0–1) |
| `--owner=ID1,ID2` | Require one or more agents to approve winner |
| `--ownerMin=X` | Minimum score required from owners (default 0.8) |
| `--ownerMode=any,all` | Require any or all owners to approve (default `any`) |
| `--logDir=DIR` | Directory for logs (default `logs`) |
| `--sessionTag=TAG` | Custom tag for log directory |
| `--quiet` | Suppress console output (still writes logs) |
| `--no-color` | Disable ANSI colours |

### Agents configuration

Agents are defined in `agents.json`.  Each entry specifies:

- `id` – unique identifier used internally
- `displayName` – friendly name shown in logs
- `cmd` – command to execute (e.g. `claude`, `gemini`)
- `args` – array of command‑line arguments; use `{PROMPT}` as a placeholder for the full prompt string
- `inputMode` – `stdin` if the prompt should be piped to standard input, otherwise `arg` to replace `{PROMPT}` in the argument list
- `supportsSystemPrefix` – whether the agent CLI supports passing a system prompt separately (ignored in this orchestrator but kept for compatibility)
- `timeoutMs` – maximum time to wait for a response
- `avatar`/`color` – optional emoji and colour for logging; these will be auto‑assigned if omitted

Adjust `agents.json` to match your installed CLIs and preferred avatars/colours.

## Development

This script uses only built‑in Node modules and does not require additional dependencies.  Feel free to extend it with additional consensus strategies, retry logic or integration with test runners.  Logging can be customised by modifying the `ConversationLogger` class in `logger.js`.

### Customising prompts

 The instructions sent to each agent are stored as Markdown files in the `prompts/` directory (`propose.md`, `critique.md` and `vote.md`).  These files are loaded at runtime by the orchestrator.  Because they are in Markdown, you can use headings, bullet lists and code fences to structure the guidance clearly.  The orchestrator will read the entire file and prepend the **USER QUESTION** and **CONTEXT** sections at run time.  Feel free to edit these Markdown files to refine the rules, improve readability or adjust the JSON schemas without touching the JavaScript code.

## License

This project is provided as‑is without warranty.  Use and modify at your own risk.