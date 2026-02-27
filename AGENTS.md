# AGENTS.md

Multi-agent orchestration CLI (Excalibur) — coordinates AI model CLIs in structured debates to reach consensus via proposal → critique → vote cycles.

## Commands

```bash
npm run typecheck     # Type check (tsc --noEmit)
npm run build         # Build TypeScript (tsc)
npm start -- "Q"      # Run in dev mode (tsx)
node index.js "Q"     # Run built version
node index.js         # Interactive mode
```

## Testing

No test suite. Verify manually:

```bash
node index.js "Your question" --preset=team --consensus=super
```

## Project-Specific Notes

- Single quotes, no semicolons
- Local imports require `.js` extension (e.g., `import { foo } from './bar.js'`)
- Agent config lives in `agents.json`; prompts in `prompts/*.md`
