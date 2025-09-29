# Revision Prompt

<agents>{{AGENTS}}</agents>

## Purpose

Review the critiques you received from other agents about your proposal. **Critically evaluate each piece of feedback** - you should only revise your proposal if the feedback is genuinely valid and improves your solution. **You have every right to reject feedback** that you believe is incorrect, misunderstands your approach, or would make your solution worse.

Maintain your professional judgment - don't change your proposal just to appease others if you believe your original approach is superior.

## Response Format

Return a single **strict JSON** object with your revised proposal:

**CRITICAL JSON RULES:**
- All strings must use proper JSON escaping: `\"` for quotes, `\\` for backslashes, `\\n` for newlines
- Use double backslashes for shell commands: `"\\copy"` not `"\copy"`
- Example: `"psql -c \"\\\\copy table FROM 'file.csv'\""` (four backslashes become two in final JSON)
- **NEVER** wrap your response in ```json code blocks - return pure JSON only

```json
{
  "revised": {
    "proposal": "<updated proposal or 'no change' if no updates needed>",
    "code_patch": "<optional updated diff>",
    "key_points": ["<updated key points>", "…"],
    "assumptions": ["<updated assumptions>", "…"],
    "risks": ["<updated risks>", "…"],
    "tests": ["<updated tests>", "…"],
    "citations": ["<updated citations>", "…"],
    "confidence": "<low|medium|high>"
  },
  "response_to_feedback": [
    {
      "critic_agent": "<exact agent id from the <agents> list above - never your own id>",
      "feedback_accepted": "<brief description of valid feedback you incorporated>",
      "feedback_rejected": "<brief description of feedback you rejected and why>",
      "action_taken": "<'revised' if you changed your proposal, 'rejected' if you disagreed with their feedback>",
      "conversation_message": "<natural human-like response to the critic that reflects the action_taken and incorporates feedback_accepted/feedback_rejected details. Address the critic_agent directly using their agent_display_names from the <agents> list above (Do not guess agent display name). NEVER include log file paths, system information, or technical metadata - only include your substantive response to the feedback. For accepted feedback, always use 'You are absolutely right' followed by the specific issue. For rejected feedback, always use 'However, I disagree with' followed by the specific issue and your reasoning. Example: '@Claude CLI, you are absolutely right about the error handling issue - COPY does fail completely on bad data. I have updated my proposal to include validation. However, I disagree with your Python suggestion because psql built-ins are more efficient and require fewer dependencies.'>"
    }
  ]
}
```

## Guidelines

- **Exercise critical judgment**: Don't automatically accept all feedback - evaluate each critique on its merits
- **Maintain your expertise**: If you believe your approach is correct, defend it with reasoning
- **Address genuinely valid concerns**: Only revise when feedback identifies real problems or improvements
- **Explain all decisions**: Clearly state what feedback you accepted, what you rejected, and why
- **Be honest about no-change**: If no feedback warranted changes, use "no change" and explain your reasoning
- **Quality over consensus**: A technically superior solution defended with good reasoning is better than changes made just to satisfy others
- **Align conversation_message**: The conversation_message must be consistent with the structured fields (critic_agent, feedback_accepted, feedback_rejected, action_taken). Don't contradict what you stated in those fields - the message should reflect and explain those decisions naturally.
- **Choose the right agent display name**: In your `conversation_message`, use the agent_display_name from the <agents> list above. Never guess agent display name