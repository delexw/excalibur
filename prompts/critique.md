# Critique Prompt

Use this prompt when agents must **evaluate and critique** their peers’ proposals.  It emphasises novelty, depth and constructive feedback.

## Purpose

Review the proposals submitted by **other agents only** (do not critique your own proposal).  Provide *substantive* and *novel* critiques.  If there are serious issues with any proposal, you must include at least one **major** or **blocker** critique.  Avoid simply agreeing with all proposals (rubber‑stamping).

Refer directly to specific claims or lines (quote minimally) to make your critique clear, and explain the impact of the issue along with a recommended fix.

## Response Format

Return a single **strict JSON** object containing only critiques of other agents' proposals:

**CRITICAL JSON RULES:**
- All strings must use proper JSON escaping: `\"` for quotes, `\\` for backslashes, `\\n` for newlines
- Use double backslashes for shell commands: `"\\copy"` not `"\copy"`
- Example: `"psql -c \"\\\\copy table FROM 'file.csv'\""` (four backslashes become two in final JSON)

```json
{
  "critiques": [
    {
      "target_agent": "<exact agent id from system configuration (e.g., 'claude', 'gemini', 'codex') - never your own id>",
      "claim_or_line": "<short quote or pointer to the offending text>",
      "severity": "<minor|major|blocker>",
      "rationale": "<why this point is wrong, risky or incomplete>",
      "evidence": ["<links or short facts supporting your critique>", "…"],
      "suggested_fix": "<concise correction or alternative approach>",
      "conversation_message": "<natural human-like message addressing the target agent that incorporates the above fields. Address them using their displayName (like 'Claude CLI', 'Gemini CLI', 'Codex CLI'), reference the claim_or_line, explain the rationale, and include the suggested_fix. Example: '@Gemini CLI, I have a major concern about \"your streaming approach\". The issue is that COPY will abort on first bad row because PostgreSQL doesn't handle errors gracefully in COPY FROM STDIN. My suggestion: implement a validation layer before COPY.'>"
    }
    /* additional critique objects for other agents */
  ]
}
```

## Guidelines

- **Only critique other agents**: Never include your own agent ID in the `target_agent` field. Only critique proposals from other agents.
- **Novelty required**: aim for at least one *novel* major or blocker critique unless none truly exist.  If no major issues are found, clearly explain why.
- **Be specific and concise**: keep quotes under 25 words and focus on the most important issues.
- **Chain‑of‑thought** is prohibited: summarise your reasoning succinctly but do not reveal hidden reasoning.
- **Align conversation_message**: The conversation_message must be consistent with and incorporate information from the other fields (target_agent, claim_or_line, severity, rationale, evidence, suggested_fix). Don't contradict or omit key details from these structured fields.