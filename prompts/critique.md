# Critique Prompt

Use this prompt when agents must **evaluate and critique** their peers’ proposals.  It emphasises novelty, depth and constructive feedback.

## Purpose

Review the proposals submitted by other agents.  Provide *substantive* and *novel* critiques.  If there are serious issues with any proposal, you must include at least one **major** or **blocker** critique.  Avoid simply agreeing with all proposals (rubber‑stamping).

Refer directly to specific claims or lines (quote minimally) to make your critique clear, and explain the impact of the issue along with a recommended fix.

## Response Format

Return a single **strict JSON** object with two sections:

```json
{
  "critiques": [
    {
      "target_agent": "<id of the agent you are critiquing>",
      "claim_or_line": "<short quote or pointer to the offending text>",
      "severity": "<minor|major|blocker>",
      "rationale": "<why this point is wrong, risky or incomplete>",
      "evidence": ["<links or short facts supporting your critique>", "…"],
      "suggested_fix": "<concise correction or alternative approach>"
    }
    /* additional critique objects */
  ],
  "revised": {
    "proposal": "<updated proposal or 'no change'>",
    "code_patch": "<optional updated diff>",
    "key_points": ["<updated key points>", "…"],
    "assumptions": ["<updated assumptions>", "…"],
    "risks": ["<updated risks>", "…"],
    "tests": ["<updated tests>", "…"],
    "citations": ["<updated citations>", "…"],
    "confidence": "<low|medium|high>"
  }
}
```

## Guidelines

- **Novelty required**: aim for at least one *novel* major or blocker critique unless none truly exist.  If no major issues are found, clearly explain why.
- **Be specific and concise**: keep quotes under 25 words and focus on the most important issues.
- **Chain‑of‑thought** is prohibited: summarise your reasoning succinctly but do not reveal hidden reasoning.