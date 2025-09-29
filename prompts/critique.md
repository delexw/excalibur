# Critique Prompt

<agents>{{AGENTS}}</agents>

## Purpose

Review the proposals submitted by **other agents only** (do not critique your own proposal).  Provide *substantive* and *novel* critiques.  If there are serious issues with any proposal, you must include at least one **major** or **blocker** critique.  Avoid simply agreeing with all proposals (rubber‑stamping).

Refer directly to specific claims or lines (quote minimally) to make your critique clear, and explain the impact of the issue along with a recommended fix.

## Response Format

Return a single **strict JSON** object containing only critiques of other agents' proposals:

**CRITICAL JSON RULES:**
- All strings must use proper JSON escaping: `\"` for quotes, `\\` for backslashes, `\\n` for newlines
- Use double backslashes for shell commands: `"\\copy"` not `"\copy"`
- Example: `"psql -c \"\\\\copy table FROM 'file.csv'\""` (four backslashes become two in final JSON)
- **NEVER** wrap your response in ```json code blocks - return pure JSON only

```json
{
  "critiques": [
    {
      "target_agent": "<exact agent id from the <agents> list above - never your own id>",
      "points": [
        {
          "claim_or_line": "<short quote or pointer to the offending text>",
          "severity": "<minor|major|blocker>",
          "rationale": "<why this point is wrong, risky or incomplete>",
          "evidence": ["<links or short facts supporting your critique>", "…"],
          "suggested_fix": "<concise correction or alternative approach>"
        }
        /* additional critique points for the same agent */
      ],
      "conversation_message": "<natural human-like message addressing the target agent that incorporates ALL the critique points above. Use the agent_display_name from the <agents> list above (Do not guess agent display name), reference multiple claims if needed, and provide a comprehensive response with bullet points and line breaks for readability. NEVER include log file paths, system information, or technical metadata - only include your substantive critique. Example: '@Gemini CLI, I have several concerns about your approach:\n\n• Regarding \"your streaming approach\" - COPY will abort on first bad row because PostgreSQL doesn't handle errors gracefully\n• About \"batch processing\" - this could lead to memory issues with large datasets\n\nMy suggestions: implement a validation layer before COPY and consider chunked processing with intermediate commits.'>"
    }
    /* additional critique objects for other agents */
  ]
}
```

## Guidelines

- **Only critique other agents**: Never include your own agent ID in the `target_agent` field. Only critique proposals from other agents.
- **Choose the right agent display name**: In your `conversation_message`, use the agent_display_name from the <agents> list above. Never guess agent display name
- **Novelty required**: aim for at least one *novel* major or blocker critique unless none truly exist.  If no major issues are found, clearly explain why.
- **Be specific and concise**: keep quotes under 25 words and focus on the most important issues.
- **Chain‑of‑thought** is prohibited: summarise your reasoning succinctly but do not reveal hidden reasoning.
- **Align conversation_message**: The conversation_message must be consistent with and incorporate information from the other fields (target_agent, claim_or_line, severity, rationale, evidence, suggested_fix). Don't contradict or omit key details from these structured fields.