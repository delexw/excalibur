# Voting Prompt

<agents>{{AGENTS}}</agents>

## Purpose

You are voting on which proposal is best **as it stands**.  Assign each candidate a score between **0.0** and **1.0** that reflects its correctness, safety, completeness and testability.  You may optionally suggest a *merge* of proposals if combining ideas yields a superior solution.

## Response Format

Respond with a single **strict JSON** object:

**CRITICAL JSON RULES:**
- All strings must use proper JSON escaping: `\"` for quotes, `\\` for backslashes, `\\n` for newlines
- Use double backslashes for shell commands: `"\\copy"` not `"\copy"`
- Example: `"psql -c \"\\\\copy table FROM 'file.csv'\""` (four backslashes become two in final JSON)
- **NEVER** wrap your response in ```json code blocks - return pure JSON only

```json
{
  "scores": [
    { "agent_id": "<exact agent id from the agents list above - never your own id>", "score": 0.0 },
    { "agent_id": "<exact agent id from the agents list above - never your own id>", "score": 0.0 }
    /* additional score entries */
  ],
  "blocking_issues": [
    { "agent_id": "<exact agent id from the agents list above - never your own id>", "issue": "<what blocks acceptance for this candidate>" }
    /* additional blocking issue entries */
  ],
  "merge_suggestion": {
    "summary": "<optional short synthesis of a merged proposal>",
    "source_agents": ["<IDs of proposals you are merging>", "…"],
    "code_patch": "<optional merged unified diff>"
  },
  "conversation_message": "<natural human-like message explaining your voting decision with bullet points for each agent. For each agent, briefly explain why you gave them that score - what they did well or what concerns you have. Address agents using their agent_display_names from the agents list above (Do not guess agent display name). Include your overall assessment of which proposal is strongest and why. Use bullet points and line breaks for readability (Do not make agent_display_name bold). NEVER include log file paths, system information, or technical metadata - only include your substantive voting rationale. Example: 'My ratings:\n\n• @Claude CLI (0.85) - excellent error handling and safety checks\n• @Gemini CLI (0.72) - solid approach but missing edge case validation  \n• @Codex CLI (0.65) - innovative but the streaming method could fail on malformed data\n\nOverall, I think Claude's proposal is strongest because it prioritizes data integrity.'>"
}
```

## Guidelines

- **Explain each score**: In your `conversation_message`, provide specific reasoning for each agent's score - mention what they did well and any concerns you have.
- **Blocking issues**: if you score any proposal below **0.5**, you must include a corresponding entry in `blocking_issues` describing what prevents acceptance.
- **Be strict**: penalise low‑effort or unsafe proposals.  Do not rubber‑stamp.
- **Merge thoughtfully**: only propose a merge if combining elements of multiple proposals yields a clearly better outcome.