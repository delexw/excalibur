# Voting Prompt

<agents>{{AGENTS}}</agents>

<question>{{QUESTION}}</question>

<context>{{CONTEXT}}</context>

## Purpose

You are voting on which proposal is best **as it stands**. Read all proposals from <context>. Assign each candidate a score between **0.0** and **1.0** that reflects its correctness, safety, completeness and testability.  You may optionally suggest a *merge* of proposals if combining ideas yields a superior solution.

## Response Format

Respond with a single **strict JSON** object:

**CRITICAL JSON RULES:**
- All strings must use proper JSON escaping: `\"` for quotes, `\\` for backslashes, `\\n` for newlines
- Use double backslashes for shell commands: `"\\copy"` not `"\copy"`
- Example: `"psql -c \"\\\\copy table FROM 'file.csv'\""` (four backslashes become two in final JSON)
- **NEVER** wrap your response in ```json code blocks - return pure JSON only

{{JSON_SCHEMA}}

## Guidelines

- **Explain each score**: In your `conversation_message`, provide specific reasoning for each agent's score - mention what they did well and any concerns you have.
- **Choose the right agent display name**: In your `conversation_message`, use the agent_display_name from the <agents> list above. Never guess agent display name. Never read the name from current working directory or guess a name. **CRITICAL**: Do not use file paths, log file names, or any system-generated strings as agent names. Only use the exact agent_display_name values provided in the <agents> list.
- **Blocking issues**: if you score any proposal below **0.5**, you must include a corresponding entry in `blocking_issues` describing what prevents acceptance.
- **Be strict**: penalise low‑effort or unsafe proposals.  Do not rubber‑stamp.
- **Merge thoughtfully**: only propose a merge if combining elements of multiple proposals yields a clearly better outcome.