# Action Agreement Prompt

## Purpose

A consensus has been reached on a proposal. Now we need to determine if the proposed solution requires action (executing code, running commands, applying patches) and if so, whether all agents agree to proceed with the action.

## Context

The winning proposal is from agent: **{{WINNER_AGENT}}**

**Winning Proposal:**
{{FINAL_ANSWER}}

## Response Format

Return a **strict JSON** object:

{{JSON_SCHEMA}}

## Guidelines

- **is_actionable**: Set to `true` if the proposal requires executing code, running commands, or applying patches. Set to `false` if it's just informational (e.g., advice, explanation, documentation).
- **action_type**: 
  - `code_execution` - running code/scripts
  - `command_run` - executing shell commands
  - `patch_apply` - applying code changes
  - `info_only` - no action needed, just information
- **agreed**: Whether you agree with proceeding with the action
- **Be honest**: If you have concerns about the action, set `agreed` to `false` and explain why
