/**
 * Orchestration module - Multi-agent debate and consensus logic
 *
 * Handles proposal → critique → revision → vote cycles until consensus is reached.
 * Exports runOrchestration() as the main entry point.
 */

import { spawnAgentProcess } from './agent-process.js';

// Will be injected by index.js
let LOGGER = null;
let PROMPTS = null;
let CONSENSUS = null;
let DELIB = null;
let OWNER = null;
let consensusMode = 'super';
let maxRounds = 5;
let activeProcesses = null;

// Export configuration setter
export function configureOrchestration(config) {
  LOGGER = config.logger;
  PROMPTS = config.prompts;
  CONSENSUS = config.consensus;
  DELIB = config.delib;
  OWNER = config.owner;
  consensusMode = config.consensusMode;
  maxRounds = config.maxRounds;
  activeProcesses = config.activeProcesses;
}

// Generic function to log agent responses immediately based on phase
function logAgentResponse(agent, json, phase) {
  switch (phase) {
    case 'proposal':
    case 'propose':
      const proposal = json.proposal || json.answer || 'No proposal provided';
      const confidence = json.confidence ? ` I'm ${json.confidence} confident about this.` : '';
      LOGGER.line(agent, 'proposal', `My proposal: ${proposal}${confidence}`);
      break;

    case 'critique':
      const critiques = json.critiques || [];
      if (critiques.length > 0) {
        for (const c of critiques) {
          const conversationMsg = c.conversation_message;
          if (conversationMsg) {
            LOGGER.line(agent, 'critique', conversationMsg);
          }
        }
      } else {
        LOGGER.line(agent, 'critique', 'The current proposals look solid to me.');
      }
      break;

    case 'revision':
    case 'revise':
      const responses = json.response_to_feedback || [];
      for (const response of responses) {
        const conversationMsg = response.conversation_message;
        if (conversationMsg) {
          LOGGER.line(agent, 'revision', conversationMsg);
        }
      }
      break;

    case 'vote':
      const conversationMsg = json.conversation_message;
      if (conversationMsg) {
        LOGGER.line(agent, 'vote', conversationMsg);
      } else {
        LOGGER.line(agent, 'error', 'Missing conversation_message for vote response');
      }
      break;

    default:
      LOGGER.line(agent, 'warn', `Unknown phase: ${phase}`);
  }
}

// Check for interruption
function checkInterruption(agent, returnBoolean = false) {
  const INTERRUPTION_ERROR = 'Interrupted by user';

  if (global.orchestrationInterrupted) {
    if (returnBoolean) {
      return true;
    }
    return {
      ok: false,
      error: INTERRUPTION_ERROR,
      interrupted: true
    };
  }

  if (returnBoolean) {
    return false;
  }

  return null;
}

// Extract the JSON body from agent output using format-specific approach
function normalizeJsonText(txt) {
  // Handle Codex FIRST - extract content between "codex" line and "tokens used" line
  if (txt.includes('OpenAI Codex') || txt.includes('codex\n')) {
    const lines = txt.split('\n');
    let codexLineIdx = -1;
    let tokensLineIdx = -1;

    // Find the line that is exactly "codex" or "[timestamp] codex" (not "model: gpt-5-codex")
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Match only if the line is exactly "codex" or ends with "codex" after a timestamp
      if (line === 'codex' || /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\]\s*codex$/.test(line)) {
        codexLineIdx = i;
        break;
      }
    }

    // Find the line that contains "tokens used" after the codex line
    if (codexLineIdx >= 0) {
      for (let i = codexLineIdx + 1; i < lines.length; i++) {
        if (lines[i].includes('tokens used')) {
          tokensLineIdx = i;
          break;
        }
      }
    }

    // Extract content between these two lines, filtering out empty lines
    if (codexLineIdx >= 0 && tokensLineIdx > codexLineIdx) {
      const contentLines = lines.slice(codexLineIdx + 1, tokensLineIdx).filter(line => line.trim() !== '');
      txt = contentLines.join('\n').trim();
    } else if (codexLineIdx >= 0) {
      // If no tokens line found, take everything after codex line
      const contentLines = lines.slice(codexLineIdx + 1).filter(line => line.trim() !== '');
      txt = contentLines.join('\n').trim();
    }

    // For Codex, try to validate the extracted JSON immediately
    try {
      JSON.parse(txt);
      return txt;
    } catch (e) {
      // If JSON parsing fails, try to find just the outermost braces
      const first = txt.indexOf('{');
      const last = txt.lastIndexOf('}');
      if (first >= 0 && last > first) {
        const candidate = txt.slice(first, last + 1);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch (e2) {
          // If that fails too, return the original extracted text
          return txt;
        }
      }
      return txt;
    }
  }

  // Handle Gemini - remove markdown code blocks if present
  if (txt.includes('```json')) {
    const jsonStart = txt.indexOf('```json') + 7;
    const jsonEnd = txt.indexOf('```', jsonStart);
    if (jsonEnd > jsonStart) {
      txt = txt.slice(jsonStart, jsonEnd).trim();
    }
  }

  // Generic fallback - find the outermost JSON object
  const first = txt.indexOf('{');
  const last = txt.lastIndexOf('}');

  if (first >= 0 && last > first) {
    // Extract content between first { and last }
    const jsonCandidate = txt.slice(first, last + 1).trim();

    // Validate it's proper JSON by trying to parse
    try {
      JSON.parse(jsonCandidate);
      return jsonCandidate;
    } catch (e) {
      // If parsing fails, fall back to original text
      return txt.trim();
    }
  }

  // If no braces found, return original text
  return txt.trim();
}

// Build a prompt for an agent with optional context
function buildPrompt(base, question, context = {}, agents = []) {
  // Replace {{AGENTS}} placeholder with agent list
  let prompt = base;
  if (prompt.includes('{{AGENTS}}')) {
    const agentList = JSON.stringify(agents.map(agent => ({
      agent_id: agent.id,
      agent_display_name: `>${agent.displayName}`
    })), null, 2);
    prompt = prompt.replace('{{AGENTS}}', agentList);
  }

  return `${prompt}\n\nUSER QUESTION:\n${question}\n\nCONTEXT:\n${JSON.stringify(context, null, 2)}\n\nReturn JSON only.`;
}

// Spawn an agent CLI process with prompt; return JSON output or error (single attempt)
async function spawnAgentOncePTY(agent, prompt, timeoutSec, phase = 'response') {
  try {
    // Check for interruption before spawning
    const interruption = checkInterruption(agent);
    if (interruption) {
      return interruption;
    }

    // Use shared spawn utility (DRY principle)
    const timeout = Math.max(agent.timeoutMs || timeoutSec * 1000, timeoutSec * 1000);
    const result = await spawnAgentProcess(agent, prompt, {
      timeout,
      processTracker: activeProcesses
    });

    let stdout = result.output;

    try {
      // Log raw stdout for debugging
      LOGGER.line(agent, 'response:raw', stdout, true);

      // Strip ANSI escape codes before JSON parsing
      // eslint-disable-next-line no-control-regex
      stdout = stdout.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
      stdout = stdout.replace(/\x1B\][^\x07]*\x07/g, '');
      stdout = stdout.replace(/\x1B[P\]^_][^\x07\x1B]*[\x07\x1B]/g, '');

      const normalizedJsonText = normalizeJsonText(stdout);

      // Log normalized text for debugging
      LOGGER.line(agent, 'response:normalized', normalizedJsonText, true);

      const json = JSON.parse(normalizedJsonText);

      // Log the response immediately
      logAgentResponse(agent, json, phase);

      return { ok: true, json, raw: stdout };
    } catch (parseErr) {
      // Log the failed normalized text to help debug
      const normalizedJsonText = normalizeJsonText(stdout);
      LOGGER.line(agent, 'parse:error', `Parse failed. Normalized text: ${normalizedJsonText.substring(0, 200)}...`, true);

      return { ok: false, error: `Non‑JSON or parse error from ${agent.id}: ${parseErr.message}`, raw: stdout };
    }
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// Spawn an agent CLI process with retry logic for failed attempts
async function spawnAgent(agent, prompt, timeoutSec, phase = 'response') {
  const maxRetries = 3; // Retry Claude CLI calls, others once only
  const baseDelay = 1000; // 1 second base delay

  let lastResult;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Check for interruption before each attempt
    const interruption = checkInterruption(agent);
    if (interruption) {
      return interruption;
    }

    const result = await spawnAgentOncePTY(agent, prompt, timeoutSec, phase);
    lastResult = result;

    if (result.ok) {
      if (attempt > 1) {
        LOGGER.line(agent, 'retry:success', `Succeeded on attempt ${attempt}/${maxRetries}`, true);
      }

      return result;
    }

    // Don't retry on command not found (system configuration issues)
    if (result.error?.includes('Failed to spawn')) {
      return result;
    }

    // Log retry attempt only if we're not on the final attempt
    if (attempt < maxRetries) {
      const delay = baseDelay * attempt;
      LOGGER.line(agent, 'retry', `Attempt ${attempt}/${maxRetries} failed. Retrying in ${delay}ms...`, true);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return lastResult;
}

// Round 0: all agents propose initial solutions
async function roundPropose(agents, question) {
  const prompt = buildPrompt(PROMPTS.propose, question, {}, agents);
  const results = await Promise.all(
    agents.map(async a => {
      const res = await spawnAgent(a, prompt, 300, 'propose');
      return { agentId: a.id, res };
    })
  );

  return results;
}

// Critique phase: each agent critiques the current set of proposals
async function roundCritique(agents, question, current) {
  const prompt = buildPrompt(
    PROMPTS.critique,
    question,
    { current_proposals: current },
    agents
  );
  const results = await Promise.all(
    agents.map(async a => {
      const res = await spawnAgent(a, prompt, 300, 'critique');
      return { agentId: a.id, res };
    })
  );

  return results;
}

// Revision phase: agents revise their proposals in response to peer critiques
async function roundRevise(agents, question, current, critiques) {
  // Convert critiques array to a map for easier lookup
  const critiqueMap = new Map(critiques.map(c => [c.agentId, c.res?.json?.critiques || []]));

  const results = await Promise.all(
    agents.map(async a => {
      // Find this agent's original proposal
      const originalProposal = current.find(p => p.agentId === a.id);
      if (!originalProposal) {
        return { agentId: a.id, res: { ok: false, error: 'No proposal found for agent' } };
      }

      // Collect critiques that this agent received
      const receivedCritiques = [];
      for (const [criticId, critsForThisAgent] of critiqueMap) {
        // Each critique object has {target_agent_id, severity, detail}
        const relevantCritiques = critsForThisAgent.filter(c => c.target_agent_id === a.id);
        for (const crit of relevantCritiques) {
          receivedCritiques.push({
            from_agent_id: criticId,
            ...crit
          });
        }
      }

      // Build prompt with original proposal and critiques
      const prompt = buildPrompt(
        PROMPTS.revise,
        question,
        {
          your_proposal: originalProposal.payload,
          critiques_received: receivedCritiques
        },
        agents
      );

      const res = await spawnAgent(a, prompt, 300, 'revise');
      return { agentId: a.id, res };
    })
  );

  return results;
}

// Voting phase: each agent votes on all current proposals
async function roundVote(agents, question, current) {
  const prompt = buildPrompt(
    PROMPTS.vote,
    question,
    { current_proposals: current },
    agents
  );
  const results = await Promise.all(
    agents.map(async a => {
      const res = await spawnAgent(a, prompt, 300, 'vote');
      return { agentId: a.id, res };
    })
  );

  return results;
}

// Main orchestration logic
export async function runOrchestration(userQuestion, agents, paint) {
  // Reset interruption flag at the start
  global.orchestrationInterrupted = false;

  // Set agents in logger for conversation highlighting
  LOGGER.setAgents(agents);

  // Display session configuration
  LOGGER.blockTitle(`Session ${LOGGER.session} — ${agents.length} agents`);

  if (!LOGGER.quiet) {
    console.log(paint(`Owners: ${OWNER.ids.length ? OWNER.ids.join(', ') : 'none'} | ownerMin=${OWNER.minScore} | ownerMode=${OWNER.mode}\n`, 'gray'));
    console.log(paint(`Consensus=${consensusMode} | thresholds: U=${CONSENSUS.unanimousPct} S=${CONSENSUS.superMajorityPct} M=${CONSENSUS.majorityPct} | blockers=${CONSENSUS.requireNoBlockers ? 'strict' : 'allowed'} | rubberPenalty=${DELIB.weightPenaltyRubberStamp}\n`, 'gray'));
  }

  // Log the question
  LOGGER.line({ id: 'orchestrator', avatar: '🗂️', displayName: 'Orchestrator', color: 'white' }, 'question', userQuestion);

  // Round 0: initial proposals
  LOGGER.blockTitle('Initial Proposals ......');

  // Show agents are working on their proposals
  for (const agent of agents) {
    LOGGER.line(agent, '', 'Crafting my solution approach...');
  }

  const r0 = await roundPropose(agents, userQuestion);

  // Check for interruption
  if (checkInterruption(null, true)) {
    return;
  }

  const okR0 = r0.filter(x => x.res && x.res.ok);
  if (!okR0.length) {
    console.error('No proposals received. Aborting.');
    process.exit(1);
  }

  // Prepare state: list of current proposals per agent
  let current = okR0.map(p => ({ agentId: p.agentId, payload: p.res.json }));
  // Set of seen critique pairs for novelty scoring
  let seenPairs = new Set();

  // Critique/vote rounds
  for (let round = 1; round <= maxRounds; round++) {
    LOGGER.blockTitle(`Round ${round}: critiques & voting`);

    // Show agents are working on critiques
    for (const agent of agents) {
      LOGGER.line(agent, '', 'Reviewing peer proposals...');
    }

    // Critique phase
    const crits = await roundCritique(agents, userQuestion, current);

    // Check for interruption
    if (checkInterruption(null, true)) {
      return;
    }

    // Revision phase
    const revisions = await roundRevise(agents, userQuestion, current, crits);

    // Check for interruption
    if (checkInterruption(null, true)) {
      return;
    }

    // Update current proposals with revisions
    for (const rev of revisions) {
      if (rev.res && rev.res.ok) {
        const idx = current.findIndex(p => p.agentId === rev.agentId);
        if (idx >= 0) {
          current[idx].payload = rev.res.json;
        }
      }
    }

    // Voting phase
    const votes = await roundVote(agents, userQuestion, current);

    // Check for interruption
    if (checkInterruption(null, true)) {
      return;
    }

    // Process votes and check for consensus
    const okVotes = votes.filter(v => v.res && v.res.ok);
    if (okVotes.length === 0) {
      LOGGER.blockTitle('No votes received, continuing...');
      continue;
    }

    // Calculate vote tallies
    const tallies = new Map();
    for (const agentId of current.map(p => p.agentId)) {
      tallies.set(agentId, { score: 0, voters: [] });
    }

    for (const vote of okVotes) {
      const voteData = vote.res.json.vote || {};
      for (const [targetId, score] of Object.entries(voteData)) {
        if (tallies.has(targetId)) {
          const tally = tallies.get(targetId);
          tally.score += score;
          tally.voters.push(vote.agentId);
        }
      }
    }

    // Check consensus
    const threshold = consensusMode === 'unanimous' ? CONSENSUS.unanimousPct :
                     consensusMode === 'super' ? CONSENSUS.superMajorityPct :
                     CONSENSUS.majorityPct;

    const maxScore = Math.max(...Array.from(tallies.values()).map(t => t.score));
    const normalizedMaxScore = maxScore / okVotes.length;

    LOGGER.blockTitle(`Consensus check: ${normalizedMaxScore.toFixed(2)} vs threshold ${threshold}`);

    if (normalizedMaxScore >= threshold) {
      // Find winning proposal
      const winnerId = Array.from(tallies.entries())
        .find(([id, tally]) => tally.score === maxScore)?.[0];

      const winner = current.find(p => p.agentId === winnerId);

      LOGGER.blockTitle(`✅ Consensus reached! Winner: ${winnerId}`);

      return winner.payload.proposal || winner.payload.answer || 'No proposal text';
    }
  }

  // No consensus reached
  LOGGER.blockTitle('❌ No consensus reached after maximum rounds');

  // Return the highest-scored proposal
  const tallies = new Map();
  for (const agentId of current.map(p => p.agentId)) {
    tallies.set(agentId, { score: 0 });
  }

  // Recalculate final tallies
  const maxScore = Math.max(...Array.from(tallies.values()).map(t => t.score));
  const winnerId = Array.from(tallies.entries())
    .find(([id, tally]) => tally.score === maxScore)?.[0];

  const winner = current.find(p => p.agentId === winnerId);

  return winner?.payload.proposal || winner?.payload.answer || 'No consensus reached';
}
