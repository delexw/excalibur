# Action Execution Prompt

<proposal>{{PROPOSAL}}</proposal>

<code_path>{{CODE_PATCH}}</code_path>

<tests>{{TESTS}}</tests>

## Execute

Working directory: <cwd>{{CWD}}</cwd>

Execute the above commands/tests and return JSON with this schema:
```json
{
  "executed": true|false,
  "output": "<what was executed and results>",
  "error": "<any errors encountered, or null if none>",
  "files_created": ["list of files created if any"],
  "files_modified": ["list of files modified if any"]
}
```

Return JSON only.
