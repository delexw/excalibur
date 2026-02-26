import type { ChildProcess } from 'node:child_process';

export interface Agent {
  id: string;
  displayName: string;
  cmd: string;
  args: string[];
  inputMode?: 'arg' | 'stdin';
  supportsSystemPrefix?: boolean;
  timeoutMs?: number;
  avatar: string;
  color: string;
  responseParser?: string;
}

export interface Orchestrator {
  id: string;
  displayName: string;
  avatar?: string;
  color?: string;
}

export interface ConsensusConfig {
  unanimousPct: number;
  superMajorityPct: number;
  majorityPct: number;
  requireNoBlockers: boolean;
  rubberPenalty: number;
  responseThreshold: number;
}

export interface OwnerConfig {
  ids: string[];
  minScore: number;
  mode: 'any' | 'all';
}

export interface LogConfig {
  dir: string;
  session: string;
  noColor: boolean;
  quiet: boolean;
}

export interface ConfigSettings {
  consensusMode: string;
  maxRounds: number;
  consensus: ConsensusConfig;
  owner: OwnerConfig;
  log: LogConfig;
  sysPrompts: SysPrompts;
  orchestrator: Orchestrator;
}

export interface SysPrompts {
  propose: string;
  critique: string;
  revise: string;
  vote: string;
  actionAgree: string;
  actionExecute: string;
}

export const DEFAULT_SYS_PROMPTS: SysPrompts = {
  propose: '',
  critique: '',
  revise: '',
  vote: '',
  actionAgree: '',
  actionExecute: '',
};


export interface Scorecard {
  agentId: string;
  avatar?: string;
  displayName?: string;
  avgPeerScore?: number;
  novelCritiques: number;
  blockers: number;
  rubber: boolean;
}

export interface LogEvent {
  t: string;
  agentId: string;
  phase: string;
  text: string;
}

export interface Meta {
  session: string;
  startedAt: string;
  events: LogEvent[];
}

export interface LoggerOptions {
  noColor?: boolean;
  quiet?: boolean;
  agents?: Agent[];
  blessedUI?: BlessedUI | null;
}

export interface FormatTextOptions {
  bold?: boolean;
  forBlessed?: boolean;
  noColor?: boolean;
}

export interface HighlightOptions {
  forBlessed?: boolean;
  noColor?: boolean;
  phase?: string | null;
  phaseColor?: string;
}

export interface BlessedUI {
  setHeaderMessage?: (text: string) => void;
  appendToAgent?: (agentId: string, text: string) => void;
  setAgentStatus?: (agentId: string, status: 'running' | 'completed' | 'failed') => void;
}

export type ConfigValue = string | number | boolean | string[] | ConsensusConfig | OwnerConfig | LogConfig | SysPrompts | Orchestrator | ConfigSettings | undefined;

export interface UIModes {
  INTERACTIVE: string;
  ORCHESTRATION: string;
}

export interface BlessedWidgetOptions {
  [key: string]: string | number | boolean | BlessedWidgetOptions | undefined;
}

export interface ConfigPaths {
  userConfig: string;
  cwdConfig: string;
  packageConfig: string;
}

export interface ConfigInfo {
  paths: ConfigPaths;
  currentConfig: string;
}

export interface SessionManagerOptions {
  agents?: Agent[];
}

export interface HistoryEntry {
  timestamp: string;
  command: string;
  result: string;
}

// --- Prompt Response Payload Types ---

/** JSON response from propose.md prompt */
export interface ProposalPayload {
  proposal: string;
  code_patch?: string;
  key_points: string[];
  assumptions: string[];
  risks: string[];
  tests: string[];
  citations?: string[];
  confidence: 'low' | 'medium' | 'high';
}

/** Single critique point from critique.md prompt */
export interface CritiquePoint {
  claim_or_line: string;
  severity: 'minor' | 'major' | 'blocker';
  rationale: string;
  evidence: string[];
  suggested_fix: string;
}

/** Critique entry targeting a specific agent */
export interface CritiqueEntry {
  target_agent: string;
  points: CritiquePoint[];
  conversation_message: string;
}

/** JSON response from critique.md prompt */
export interface CritiquePayload {
  critiques: CritiqueEntry[];
}

export interface VoteScore {
  agent_id: string;
  score: number;
}

export interface BlockingIssue {
  agent_id: string;
  issue: string;
}

export interface MergeSuggestion {
  summary: string;
  source_agents: string[];
  code_patch?: string;
}

/** JSON response from vote.md prompt */
export interface VotePayload {
  scores: VoteScore[];
  blocking_issues: BlockingIssue[];
  merge_suggestion?: MergeSuggestion;
  conversation_message: string;
}

/** Revised proposal with change tracking, from revise.md */
export interface RevisedProposal extends ProposalPayload {
  is_changed: boolean;
}

export interface FeedbackResponse {
  critic_agent: string;
  feedback_accepted: string;
  feedback_rejected: string;
  action_taken: 'revised' | 'rejected';
  conversation_message: string;
}

/** JSON response from revise.md prompt */
export interface RevisionPayload {
  revised: RevisedProposal;
  response_to_feedback: FeedbackResponse[];
}

export type ActionType = 'code_execution' | 'command_run' | 'patch_apply' | 'info_only';

/** JSON response from action-agree.md prompt */
export interface ActionAgreePayload {
  is_actionable: boolean;
  action_type: ActionType;
  action_description: string;
  agreed: boolean;
  reason: string;
}

/** JSON response from action-execute.md prompt */
export interface ActionExecutePayload {
  executed: boolean;
  output: string;
  error: string | null;
  files_created: string[];
  files_modified: string[];
}

/** Union of all possible agent JSON response payloads */
export type AgentResponsePayload =
  | ProposalPayload
  | CritiquePayload
  | VotePayload
  | RevisionPayload
  | ActionAgreePayload
  | ActionExecutePayload;

export interface ReceivedCritique {
  from_agent_id: string;
  points: CritiquePoint[];
}

/** Context data passed to prompt templates */
export interface PromptContext {
  current_proposals?: Proposal[];
  your_proposal?: ProposalPayload | RevisionPayload;
  critiques_received?: ReceivedCritique[];
}

/** Type guard to distinguish RevisionPayload from ProposalPayload */
export function isRevisionPayload(payload: ProposalPayload | RevisionPayload): payload is RevisionPayload {
  return 'revised' in payload;
}

// --- Core Domain Types ---

export interface AgentPhaseResult {
  agentId: string;
  res: ParseResult;
}

export interface Proposal {
  agentId: string;
  payload: ProposalPayload | RevisionPayload;
}

export interface Critique {
  agentId: string;
  res?: ParseResult;
  target_agent?: string;
  points?: CritiquePoint[];
}

export type Vote = AgentPhaseResult;

export interface RoundResult {
  interrupted?: boolean;
  crits?: AgentPhaseResult[];
  revisions?: AgentPhaseResult[];
  votes?: AgentPhaseResult[];
  failed?: boolean;
  results?: AgentPhaseResult[];
}

export interface ConsensusResult {
  consensusReached: boolean;
  winner?: Proposal;
  winnerId?: string;
  score?: number;
  votes?: Vote[];
}

export interface ApprovalResult {
  approved: boolean;
  ownerScores: Map<string, number>;
  ownersAboveMin?: string[];
}

export interface ActionResult {
  shouldExecute: boolean;
  actionable: boolean;
  winnerId?: string;
  winnerAgent?: Agent;
  agreementRate?: number;
  agreedCount?: number;
  totalVoters?: number;
  payload?: ProposalPayload;
}

export interface Tally {
  score: number;
  voters: string[];
}

export type ColorName = 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'gray' | 'white';

export interface ParseResult {
  ok: boolean;
  json: AgentResponsePayload;
  raw: string;
  error?: string;
}

export interface SpawnOptions {
  timeout?: number;
  onStdout?: ((text: string) => void) | null;
  onStderr?: ((text: string) => void) | null;
}

export interface SpawnResult {
  ok: boolean;
  output: string;
  error: string;
}

export interface BlessedInteractiveOptions {
  sessionManager?: SessionManager;
  logger?: ConversationLogger | null;
  processManager?: ProcessManager | null;
  agents?: Agent[];
  config?: ConfigSettings;
}

export interface ConsensusFailure {
  consensusReached: false;
}

export type OrchestrationResult = string | ConsensusFailure | undefined;

export interface DirectRunnerResult {
  success: boolean;
  finalAnswer?: OrchestrationResult;
  error?: string;
}

export interface DirectRunnerOptions {
  logger?: ConversationLogger | null;
  processManager?: ProcessManager | null;
  agents?: Agent[];
  config?: ConfigSettings;
}

export interface OrchestratorOptions {
  logger?: ConversationLogger | null;
  prompts?: SysPrompts;
  consensus?: ConsensusConfig;
  owner?: OwnerConfig;
  consensusMode?: string;
  maxRounds?: number;
  processManager?: ProcessManager | null;
  agents?: Agent[];
  orchestrator?: Orchestrator;
}

export interface PromptBuilderOptions {
  agents?: Agent[];
}

export interface ResponseValidatorOptions {
  logger?: ConversationLogger | null;
  agents?: Agent[];
  threshold?: number;
  orchestrator?: Orchestrator;
}

export interface AgentSpawnerOptions {
  logger?: ConversationLogger | null;
  processManager?: ProcessManager | null;
  maxRetries?: number;
  baseDelay?: number;
}

export interface PhaseHandlerOptions {
  agents?: Agent[];
  promptBuilder?: PromptBuilder;
  agentSpawner?: AgentSpawner;
  responseValidator?: ResponseValidator;
  promptTemplate?: string;
  phaseName?: string;
  roundName?: string;
  prompts?: SysPrompts;
}


export interface OwnerApprovalHandlerOptions {
  logger?: ConversationLogger | null;
  owner?: OwnerConfig;
}

export interface ActionHandlerOptions {
  logger?: ConversationLogger | null;
  agents?: Agent[];
  prompts?: SysPrompts;
  agentSpawner?: AgentSpawner;
  responseFormatter?: ResponseFormatter;
}

export interface ResponseFormatterOptions {
  logger?: ConversationLogger | null;
}

export interface ConsensusHandlerOptions {
  logger?: ConversationLogger | null;
  agents?: Agent[];
  consensus?: ConsensusConfig;
  consensusMode?: string;
  maxRounds?: number;
  prompts?: SysPrompts;
  agentSpawner?: AgentSpawner;
  owner?: OwnerConfig;
}

export interface RoundIteratorOptions {
  maxRounds?: number;
  logger?: ConversationLogger | null;
  agents?: Agent[];
  prompts?: SysPrompts;
  promptBuilder?: PromptBuilder;
  agentSpawner?: AgentSpawner;
  responseValidator?: ResponseValidator;
  consensus?: ConsensusConfig;
  consensusMode?: string;
  owner?: OwnerConfig;
  orchestrator?: Orchestrator;
}

export interface PromptBuilder {
  build(base: string, question: string, context?: PromptContext, agents?: Agent[]): string;
}

export interface ResponseValidator {
  validate(results: AgentPhaseResult[], roundName: string): AgentPhaseResult[] | null;
}

export interface AgentSpawner {
  spawn(agent: Agent, prompt: string, timeoutSec: number, phase?: string): Promise<ParseResult>;
  checkInterruption(returnBoolean?: boolean): boolean | ParseResult | null;
}

export interface ResponseFormatter {
  formatActionResponse(actionResult: ActionResult, winningPayload: ProposalPayload, executionResult: ParseResult, orchestrator: Agent | Orchestrator): string;
  formatFinalAnswer(payload: ProposalPayload | undefined): string;
}

export interface ConversationLogger {
  baseDir: string;
  streams: Map<string, NodeJS.WritableStream>;
  meta: Meta;
  blessedUI: BlessedUI | null;
  noColor: boolean;
  agents: Agent[];
  blockTitle(title: string): void;
  line(agent: Agent | Orchestrator, phase: string, text: string, fileOnly?: boolean): void;
  get session(): string;
  get quiet(): boolean;
  setBlessedUI(blessedUI: BlessedUI | null): void;
  summary(scorecards: Scorecard[]): void;
  end(): void;
  agentFile(agentId: string): NodeJS.WritableStream | undefined;
}

export interface ProcessManager {
  processes: Map<string, ChildProcess>;
  [Symbol.iterator](): Iterator<ChildProcess>;
  add(agentId: string, process: ChildProcess): void;
  delete(agentId: string): void;
  has(agentId: string): boolean;
  get(agentId: string): ChildProcess | undefined;
  get size(): number;
  clear(): void;
  forEach(callback: (proc: ChildProcess, id: string) => void): void;
  killAll(signal?: string): void;
  spawnProcess(agent: Agent, prompt: string, options?: SpawnOptions): Promise<SpawnResult>;
  _killProcesses(signal: string, agentId?: string | null, timeoutMs?: number): void;
}

export interface SessionManager {
  history: HistoryEntry[];
  agents: Agent[];
  addToHistory(command: string, result: boolean): void;
  getHistory(): HistoryEntry[];
}
