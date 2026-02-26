/**
 * Schema hints that map TypeScript payload types to JSON example blocks
 * for prompt injection. This is the single source of truth — prompts
 * reference these instead of duplicating JSON schemas.
 */

// ── Value node types ────────────────────────────────────────────────

/** A quoted string value: rendered as "hint" */
interface QuotedHint {
  type: 'quoted'
  hint: string
}

/** A bare (unquoted) value: rendered as-is (e.g. true|false, 0.0) */
interface BareHint {
  type: 'bare'
  value: string
}

/** An array of items, optionally with ellipsis and trailing comment */
interface ArrayNode {
  type: 'array'
  items: SchemaNode[]
  ellipsis?: boolean
  comment?: string
}

/** An object with named fields, optionally with a trailing comment */
interface ObjectNode {
  type: 'object'
  fields: [string, SchemaNode][]
  comment?: string
}

type SchemaNode = QuotedHint | BareHint | ArrayNode | ObjectNode

// ── Helper constructors ─────────────────────────────────────────────

function q(hint: string): QuotedHint {
  return { type: 'quoted', hint }
}

function bare(value: string): BareHint {
  return { type: 'bare', value }
}

function arr(items: SchemaNode[], opts: { ellipsis?: boolean; comment?: string } = {}): ArrayNode {
  return { type: 'array', items, ellipsis: opts.ellipsis, comment: opts.comment }
}

function obj(fields: [string, SchemaNode][], opts: { comment?: string } = {}): ObjectNode {
  return { type: 'object', fields, comment: opts.comment }
}

// ── Reusable sub-schemas (mirror types.ts interfaces) ───────────────

const critiquePointNode: ObjectNode = obj([
  ['claim_or_line', q('<short quote or pointer to the offending text>')],
  ['severity', q('<minor|major|blocker>')],
  ['rationale', q('<why this point is wrong, risky or incomplete>')],
  ['evidence', arr([q('<links or short facts supporting your critique>')], { ellipsis: true })],
  ['suggested_fix', q('<concise correction or alternative approach>')],
])

const proposalFieldEntries: [string, SchemaNode][] = [
  ['proposal', q('<3\u20138 sentences or concise bullets in PLAIN ENGLISH>')],
  ['code_patch', q('<optional unified diff as a single string>')],
  ['key_points', arr([q('<1\u20136 bullets summarising the core reasoning in PLAIN ENGLISH>')])],
  ['assumptions', arr([q('<explicit assumptions made in PLAIN ENGLISH>')], { ellipsis: true })],
  ['risks', arr([q('<likely failure modes or trade\u2011offs in PLAIN ENGLISH>')], { ellipsis: true })],
  ['tests', arr([q('<shell commands or steps to validate your proposal in PLAIN ENGLISH>')], { ellipsis: true })],
  ['citations', arr([q('<optional citations or sources in PLAIN ENGLISH>')], { ellipsis: true })],
  ['confidence', q('<low|medium|high>')],
]

// ── Top-level payload schemas keyed by prompt name ──────────────────

export const PAYLOAD_SCHEMAS: Record<string, ObjectNode> = {
  propose: obj(proposalFieldEntries),

  critique: obj([
    ['critiques', arr([
      obj([
        ['target_agent', q('<exact agent id from the <agents> list above - never your own id>')],
        ['points', arr([critiquePointNode], { comment: 'additional critique points for the same agent' })],
        ['conversation_message', q('<natural human-like message addressing the target agent that incorporates ALL the critique points above. Reference multiple claims if needed, and provide a comprehensive response with bullet points and line breaks for readability. Example: \'>Agent Display Name, I have several concerns about your approach:\\n\\n\u2022 Regarding \\"your streaming approach\\" - COPY will abort on first bad row because PostgreSQL doesn\'t handle errors gracefully\\n\u2022 About \\"batch processing\\" - this could lead to memory issues with large datasets\\n\\nMy suggestions: implement a validation layer before COPY and consider chunked processing with intermediate commits.\'>')],
      ]),
    ], { comment: 'additional critique objects for other agents' })],
  ]),

  vote: obj([
    ['scores', arr([
      obj([
        ['agent_id', q('<exact agent id from the <agents> list above - never your own id>')],
        ['score', bare('0.0')],
      ]),
      obj([
        ['agent_id', q('<exact agent id from the <agents> list above - never your own id>')],
        ['score', bare('0.0')],
      ]),
    ], { comment: 'additional score entries' })],
    ['blocking_issues', arr([
      obj([
        ['agent_id', q('<exact agent id from the <agents> list above - never your own id>')],
        ['issue', q('<what blocks acceptance for this candidate>')],
      ]),
    ], { comment: 'additional blocking issue entries' })],
    ['merge_suggestion', obj([
      ['summary', q('<optional short synthesis of a merged proposal>')],
      ['source_agents', arr([q('<IDs of proposals you are merging>')], { ellipsis: true })],
      ['code_patch', q('<optional merged unified diff>')],
    ])],
    ['conversation_message', q('<natural human-like message explaining your voting decision with bullet points for each agent. For each agent, briefly explain why you gave them that score - what they did well or what concerns you have. Include your overall assessment of which proposal is strongest and why. Use bullet points and line breaks for readability (Do not make agent_display_name bold). Example: \'My ratings:\\n\\n\u2022 >Agent Display Name (0.85) - excellent error handling and safety checks\\n\u2022 >Another Agent Name (0.72) - solid approach but missing edge case validation  \\n\u2022 >Third Agent Name (0.65) - innovative but the streaming method could fail on malformed data\\n\\nOverall, I think the first agent\'s proposal is strongest because it prioritizes data integrity.\'>')],
  ]),

  revise: obj([
    ['revised', obj([
      ['is_changed', bare('true|false')],
      ['proposal', q('<updated proposal or original proposal if no updates needed>')],
      ['code_patch', q('<optional updated diff>')],
      ['key_points', arr([q('<updated key points>')], { ellipsis: true })],
      ['assumptions', arr([q('<updated assumptions>')], { ellipsis: true })],
      ['risks', arr([q('<updated risks>')], { ellipsis: true })],
      ['tests', arr([q('<updated tests>')], { ellipsis: true })],
      ['citations', arr([q('<updated citations>')], { ellipsis: true })],
      ['confidence', q('<low|medium|high>')],
    ])],
    ['response_to_feedback', arr([
      obj([
        ['critic_agent', q('<exact agent id from the <agents> list above - never your own id>')],
        ['feedback_accepted', q('<brief description of valid feedback you incorporated>')],
        ['feedback_rejected', q('<brief description of feedback you rejected and why>')],
        ['action_taken', q('<\'revised\' if you changed your proposal, \'rejected\' if you disagreed with their feedback>')],
        ['conversation_message', q('<natural human-like response to the critic that reflects the action_taken and incorporates feedback_accepted/feedback_rejected details. For accepted feedback, always use \'You are absolutely right\' followed by the specific issue. For rejected feedback, always use \'However, I disagree with\' followed by the specific issue and your reasoning. Example: \'>Agent Display Name, you are absolutely right about the error handling issue - COPY does fail completely on bad data. I have updated my proposal to include validation. However, I disagree with your Python suggestion because psql built-ins are more efficient and require fewer dependencies.\'>')],
      ]),
    ])],
  ]),

  actionAgree: obj([
    ['is_actionable', bare('true|false')],
    ['action_type', q('code_execution|command_run|patch_apply|info_only')],
    ['action_description', q('<what action will be taken in PLAIN ENGLISH>')],
    ['agreed', bare('true|false')],
    ['reason', q('<your reasoning for agreeing or disagreeing with the action>')],
  ]),

  actionExecute: obj([
    ['executed', bare('true|false')],
    ['output', q('<what was executed and results>')],
    ['error', q('<any errors encountered, or null if none>')],
    ['files_created', arr([q('list of files created if any')])],
    ['files_modified', arr([q('list of files modified if any')])],
  ]),
}

// ── Renderer: schema → JSON example string ──────────────────────────

function renderNode(node: SchemaNode, indent: number): string {
  const pad = '  '.repeat(indent)
  const innerPad = '  '.repeat(indent + 1)

  switch (node.type) {
    case 'quoted':
      return `"${node.hint}"`

    case 'bare':
      return node.value

    case 'array': {
      const lines = ['[']
      const allItems = [...node.items.map(it => renderNode(it, indent + 1))]
      if (node.ellipsis) allItems.push('"…"')
      for (let i = 0; i < allItems.length; i++) {
        const comma = i < allItems.length - 1 ? ',' : ''
        lines.push(`${innerPad}${allItems[i]}${comma}`)
      }
      if (node.comment) {
        lines.push(`${innerPad}/* ${node.comment} */`)
      }
      lines.push(`${pad}]`)
      return lines.join('\n')
    }

    case 'object': {
      const lines = ['{']
      for (let i = 0; i < node.fields.length; i++) {
        const [key, val] = node.fields[i]
        const rendered = renderNode(val, indent + 1)
        const comma = i < node.fields.length - 1 ? ',' : ''
        lines.push(`${innerPad}"${key}": ${rendered}${comma}`)
      }
      if (node.comment) {
        lines.push(`${innerPad}/* ${node.comment} */`)
      }
      lines.push(`${pad}}`)
      return lines.join('\n')
    }
  }
}

/**
 * Generate a JSON example block for a given prompt name.
 * Returns the fenced code block ready to embed in a prompt.
 */
export function generateJsonSchema(promptName: string): string {
  const schema = PAYLOAD_SCHEMAS[promptName]
  if (!schema) {
    throw new Error(`No schema defined for prompt: ${promptName}`)
  }
  const json = renderNode(schema, 0)
  return '```json\n' + json + '\n```'
}
