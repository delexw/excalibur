# Voting Prompt

This prompt governs the **voting phase**, where agents rank proposals and identify blockers.  It also allows agents to suggest a merged solution if appropriate.

## Purpose

You are voting on which proposal is best **as it stands**.  Assign each candidate a score between **0.0** and **1.0** that reflects its correctness, safety, completeness and testability.  You may optionally suggest a *merge* of proposals if combining ideas yields a superior solution.

## Response Format

Respond with a single **strict JSON** object:

**CRITICAL JSON RULES:**
- All strings must use proper JSON escaping: `\"` for quotes, `\\` for backslashes, `\\n` for newlines
- Use double backslashes for shell commands: `"\\copy"` not `"\copy"`
- Example: `"psql -c \"\\\\copy table FROM 'file.csv'\""` (four backslashes become two in final JSON)

```json
{
  "scores": [
    { "agent_id": "<candidate agent ID>", "score": 0.0 },
    { "agent_id": "<candidate agent ID>", "score": 0.0 }
    /* additional score entries */
  ],
  "blocking_issues": [
    { "agent_id": "<candidate agent ID>", "issue": "<what blocks acceptance for this candidate>" }
    /* additional blocking issue entries */
  ],
  "merge_suggestion": {
    "summary": "<optional short synthesis of a merged proposal>",
    "source_agents": ["<IDs of proposals you are merging>", "…"],
    "code_patch": "<optional merged unified diff>"
  },
  "conversation_message": "<natural human-like message explaining your voting decision. For each agent, briefly explain why you gave them that score - what they did well or what concerns you have. Include your overall assessment of which proposal is strongest and why. Example: 'My ratings: @Claude CLI (0.85) - excellent error handling and safety checks, @Gemini CLI (0.72) - solid approach but missing edge case validation, @Codex CLI (0.65) - innovative but the streaming method could fail on malformed data. Overall, I think Claude's proposal is strongest because it prioritizes data integrity.'>"
}
```

## Guidelines

- **Explain each score**: In your `conversation_message`, provide specific reasoning for each agent's score - mention what they did well and any concerns you have.
- **Blocking issues**: if you score any proposal below **0.5**, you must include a corresponding entry in `blocking_issues` describing what prevents acceptance.
- **Be strict**: penalise low‑effort or unsafe proposals.  Do not rubber‑stamp.
- **Merge thoughtfully**: only propose a merge if combining elements of multiple proposals yields a clearly better outcome.