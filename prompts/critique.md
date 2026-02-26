# Critique Prompt

<agents>{{AGENTS}}</agents>

<question>{{QUESTION}}</question>

<context>{{CONTEXT}}</context>

## Purpose

Review the proposals submitted by **other agents only** (do not critique your own proposal) from <context>.  Provide *substantive* and *novel* critiques.  If there are serious issues with any proposal, you must include at least one **major** or **blocker** critique.  Avoid simply agreeing with all proposals (rubber‑stamping).

Refer directly to specific claims or lines (quote minimally) to make your critique clear, and explain the impact of the issue along with a recommended fix.

## Response Format

Return a single **strict JSON** object containing only critiques of other agents' proposals:

**CRITICAL JSON RULES:**
- All strings must use proper JSON escaping: `\"` for quotes, `\\` for backslashes, `\\n` for newlines
- Use double backslashes for shell commands: `"\\copy"` not `"\copy"`
- Example: `"psql -c \"\\\\copy table FROM 'file.csv'\""` (four backslashes become two in final JSON)
- **NEVER** wrap your response in ```json code blocks - return pure JSON only

{{JSON_SCHEMA}}

## Guidelines

- **Only critique other agents**: Never include your own agent ID in the `target_agent` field. Only critique proposals from other agents.
- **Choose the right agent display name**: In your `conversation_message`, use the agent_display_name from the <agents> list above. Never guess agent display name. Never read the name from current working directory or guess a name. **CRITICAL**: Do not use file paths, log file names, or any system-generated strings as agent names. Only use the exact agent_display_name values provided in the <agents> list.
- **Novelty required**: aim for at least one *novel* major or blocker critique unless none truly exist.  If no major issues are found, clearly explain why.
- **Be specific and concise**: keep quotes under 25 words and focus on the most important issues.
- **Chain‑of‑thought** is prohibited: summarise your reasoning succinctly but do not reveal hidden reasoning.
- **Align conversation_message**: The conversation_message must be consistent with and incorporate information from the other fields (target_agent, claim_or_line, severity, rationale, evidence, suggested_fix). Don't contradict or omit key details from these structured fields.