/**
 * Orchestration module - Multi-agent debate and consensus logic
 *
 * Handles proposal → critique → revision → vote cycles until consensus is reached.
 * Exports runOrchestration() as the main entry point.
 */

import { spawnAgentProcess } from "./agent-process.js";
import { getParserForAgent } from "./parsers/index.js";

// Will be injected by index.js
let LOGGER = null;
let PROMPTS = null;
let CONSENSUS = null;
let DELIB = null;
let OWNER = null;
let consensusMode = "super";
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
    case "proposal":
    case "propose":
      const proposal = json.proposal || "No proposal provided";
      const confidence = json.confidence
        ? ` I'm ${json.confidence} confident about this.`
        : "";
      LOGGER.line(agent, "proposal", `My proposal: ${proposal}${confidence}`);
      break;

    case "critique":
      const critiques = json.critiques || [];
      if (critiques.length > 0) {
        for (const c of critiques) {
          const conversationMsg = c.conversation_message;
          if (conversationMsg) {
            LOGGER.line(agent, "critique", conversationMsg);
          }
        }
      } else {
        LOGGER.line(
          agent,
          "critique",
          "The current proposals look solid to me.",
        );
      }
      break;

    case "revision":
    case "revise":
      const responses = json.response_to_feedback || [];
      for (const response of responses) {
        const conversationMsg = response.conversation_message;
        if (conversationMsg) {
          LOGGER.line(agent, "revision", conversationMsg);
        }
      }
      break;

    case "vote":
      const conversationMsg = json.conversation_message;
      if (conversationMsg) {
        LOGGER.line(agent, "vote", conversationMsg);
      } else {
        LOGGER.line(
          agent,
          "error",
          "Missing conversation_message for vote response",
        );
      }
      break;

    default:
      LOGGER.line(agent, "warn", `Unknown phase: ${phase}`);
  }
}

// Check for interruption
function checkInterruption(agent, returnBoolean = false) {
  const INTERRUPTION_ERROR = "Interrupted by user";

  if (global.orchestrationInterrupted) {
    if (returnBoolean) {
      return true;
    }
    return {
      ok: false,
      error: INTERRUPTION_ERROR,
      interrupted: true,
    };
  }

  if (returnBoolean) {
    return false;
  }

  return null;
}

/**
 * Calculate vote tallies from votes
 * @param {Array} currentProposals - Current proposals
 * @param {Array} votes - Vote responses
 * @returns {Map} Tallies map with scores and voters
 */
function calculateVoteTallies(currentProposals, votes) {
  const tallies = new Map();

  // Initialize tallies for each proposal
  for (const agentId of currentProposals.map((p) => p.agentId)) {
    tallies.set(agentId, { score: 0, voters: [] });
  }

  // Accumulate scores from each vote
  for (const vote of votes) {
    const scores = vote.res.json.scores || [];
    for (const scoreEntry of scores) {
      const targetId = scoreEntry.agent_id;
      const score = scoreEntry.score;
      if (tallies.has(targetId) && typeof score === "number") {
        const tally = tallies.get(targetId);
        tally.score += score;
        tally.voters.push(vote.agentId);
      }
    }
  }

  return tallies;
}

/**
 * Check if owner approval requirements are met
 * @param {string} winnerId - ID of winning proposal
 * @param {Array} votes - Vote responses
 * @returns {Object} { approved: boolean, ownerScores: Map }
 */
function checkOwnerApproval(winnerId, votes) {
  if (OWNER.ids.length === 0) {
    return { approved: true, ownerScores: new Map() };
  }

  // Build owner scores map
  const ownerScores = new Map();
  for (const vote of votes) {
    const voterId = vote.agentId;
    if (OWNER.ids.includes(voterId)) {
      const scores = vote.res.json.scores || [];
      const ownerVote = scores.find((s) => s.agent_id === winnerId);
      if (ownerVote) {
        ownerScores.set(voterId, ownerVote.score);
      }
    }
  }

  // Check if requirements are met
  const ownersAboveMin = Array.from(ownerScores.entries())
    .filter(([_, score]) => score >= OWNER.minScore)
    .map(([id, _]) => id);

  let approved = false;
  if (OWNER.mode === "all") {
    approved = OWNER.ids.every((ownerId) => ownersAboveMin.includes(ownerId));
  } else {
    approved = ownersAboveMin.length > 0;
  }

  return { approved, ownerScores, ownersAboveMin };
}

/**
 * Log owner approval status
 * @param {Object} approvalResult - Result from checkOwnerApproval
 * @param {Array} agents - Array of agent objects
 * @param {string} winnerId - ID of winning proposal
 */
function logOwnerApproval(approvalResult, agents, winnerId) {
  const { approved, ownerScores, ownersAboveMin } = approvalResult;

  // Get winner's display name
  const winnerAgent = agents.find((a) => a.id === winnerId);
  const winnerName = winnerAgent?.displayName || winnerId;

  if (!approved) {
    LOGGER.blockTitle(
      `⚠️  Owner approval required but not met (mode=${OWNER.mode}, minScore=${OWNER.minScore})`,
    );
    LOGGER.line(
      {
        id: "orchestrator",
        avatar: "🗂️",
        displayName: "Orchestrator",
        color: "white",
      },
      "owner",
      `Owner approval not met - mode=${OWNER.mode}, minScore=${OWNER.minScore}`,
    );
    for (const ownerId of OWNER.ids) {
      const score = ownerScores.get(ownerId);
      const agent = agents.find((a) => a.id === ownerId);
      if (!agent) continue;

      if (score !== undefined) {
        if (score >= OWNER.minScore) {
          LOGGER.line(
            agent,
            "owner-approve",
            `I approve ${winnerName}'s proposal for consensus. During voting, I rated it ${score.toFixed(2)}/1.0, which meets the owner threshold of ${OWNER.minScore}.`,
          );
        } else {
          LOGGER.line(
            agent,
            "owner-reject",
            `I reject ${winnerName}'s proposal for consensus. During voting, I rated it ${score.toFixed(2)}/1.0, which is below the required owner threshold of ${OWNER.minScore}.`,
          );
        }
      } else {
        LOGGER.line(
          agent,
          "owner-reject",
          `I reject ${winnerName}'s proposal for consensus. I did not vote during the voting phase.`,
        );
      }
    }
  } else if (OWNER.ids.length > 0) {
    LOGGER.blockTitle(`✓ Owner approval granted`);
    LOGGER.line(
      {
        id: "orchestrator",
        avatar: "🗂️",
        displayName: "Orchestrator",
        color: "white",
      },
      "owner",
      `Owner approval granted - owners: ${ownersAboveMin.join(", ")}`,
    );
    for (const ownerId of ownersAboveMin) {
      const score = ownerScores.get(ownerId);
      const agent = agents.find((a) => a.id === ownerId);
      if (!agent) continue;

      LOGGER.line(
        agent,
        "owner-approve",
        `I approve ${winnerName}'s proposal for consensus. During voting, I rated it ${score.toFixed(2)}/1.0, which meets the owner threshold of ${OWNER.minScore}.`,
      );
    }
  }
}

// Helper function to format final answer with all sections
function formatFinalAnswer(payload) {
  if (!payload) {
    return "No consensus reached";
  }

  const sections = [];
  sections.push(payload.proposal || "(no proposal)");

  if (payload.code_patch) {
    sections.push("");
    sections.push("--- code_patch (unified diff) ---");
    sections.push(payload.code_patch);
  }

  if (payload.tests && payload.tests.length) {
    sections.push("");
    sections.push("Tests to run:");
    payload.tests.forEach((test) => sections.push(`- ${test}`));
  }

  if (payload.key_points && payload.key_points.length) {
    sections.push("");
    sections.push("Key points:");
    payload.key_points.forEach((point) => sections.push(`- ${point}`));
  }

  sections.push("");
  sections.push(`Confidence: ${payload.confidence || "low"}`);

  return sections.join("\n");
}

// Build a prompt for an agent with optional context
function buildPrompt(base, question, context = {}, agents = []) {
  // Replace {{AGENTS}} placeholder with agent list
  let prompt = base;
  if (prompt.includes("{{AGENTS}}")) {
    const agentList = JSON.stringify(
      agents.map((agent) => ({
        agent_id: agent.id,
        agent_display_name: `>${agent.displayName}`,
      })),
      null,
      2,
    );
    prompt = prompt.replace("{{AGENTS}}", agentList);
  }

  return `${prompt}\n\nUSER QUESTION:\n${question}\n\nCONTEXT:\n${JSON.stringify(context, null, 2)}\n\nReturn JSON only.`;
}

// Spawn an agent CLI process with prompt; return JSON output or error (single attempt)
async function spawnAgentOncePTY(
  agent,
  prompt,
  timeoutSec,
  phase = "response",
) {
  try {
    // Check for interruption before spawning
    const interruption = checkInterruption(agent);
    if (interruption) {
      return interruption;
    }

    // Set agent status to running
    if (LOGGER.blessedUI && LOGGER.blessedUI.setAgentStatus) {
      LOGGER.blessedUI.setAgentStatus(agent.id, "running");
    }

    // Use shared spawn utility (DRY principle)
    const timeout = Math.max(
      agent.timeoutMs || timeoutSec * 1000,
      timeoutSec * 1000,
    );
    const result = await spawnAgentProcess(agent, prompt, {
      timeout,
      processTracker: activeProcesses,
    });

    let stdout = result.output;

    // Get parser for this agent (uses default if not specified)
    const parser = getParserForAgent(agent);

    try {
      // Log raw stdout for debugging
      LOGGER.line(agent, "response:raw", stdout, true);

      const normalizedJsonText = parser.parse(stdout);

      // Log normalized text for debugging
      LOGGER.line(agent, "response:normalized", normalizedJsonText, true);

      const json = JSON.parse(normalizedJsonText);

      // Log the response immediately
      logAgentResponse(agent, json, phase);

      // Set agent status to completed
      if (LOGGER.blessedUI && LOGGER.blessedUI.setAgentStatus) {
        LOGGER.blessedUI.setAgentStatus(agent.id, "completed");
      }

      return { ok: true, json, raw: stdout };
    } catch (parseErr) {
      // Log the failed normalized text to help debug
      const normalizedJsonText = normalizeJsonText(stdout);
      LOGGER.line(
        agent,
        "parse:error",
        `Parse failed. Normalized text: ${normalizedJsonText}...`,
        true,
      );

      // Set agent status to failed
      if (LOGGER.blessedUI && LOGGER.blessedUI.setAgentStatus) {
        LOGGER.blessedUI.setAgentStatus(agent.id, "failed");
      }

      return {
        ok: false,
        error: `Non‑JSON or parse error from ${agent.id}: ${parseErr.message}`,
        raw: stdout,
      };
    }
  } catch (error) {
    // Set agent status to failed on any error
    if (LOGGER.blessedUI && LOGGER.blessedUI.setAgentStatus) {
      LOGGER.blessedUI.setAgentStatus(agent.id, "failed");
    }
    return { ok: false, error: error.message };
  }
}

// Spawn an agent CLI process with retry logic for failed attempts
async function spawnAgent(agent, prompt, timeoutSec, phase = "response") {
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
        LOGGER.line(
          agent,
          "retry:success",
          `Succeeded on attempt ${attempt}/${maxRetries}`,
          true,
        );
      }

      return result;
    }

    // Don't retry on command not found (system configuration issues)
    if (result.error?.includes("Failed to spawn")) {
      return result;
    }

    // Log retry attempt only if we're not on the final attempt
    if (attempt < maxRetries) {
      const delay = baseDelay * attempt;
      LOGGER.line(
        agent,
        "retry",
        `Attempt ${attempt}/${maxRetries} failed. Retrying in ${delay}ms...`,
        true,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return lastResult;
}

// Round 0: all agents propose initial solutions
async function roundPropose(agents, question) {
  const prompt = buildPrompt(PROMPTS.propose, question, {}, agents);
  const results = await Promise.all(
    agents.map(async (a) => {
      const res = await spawnAgent(a, prompt, 300, "propose");
      return { agentId: a.id, res };
    }),
  );

  return results;
}

// Critique phase: each agent critiques the current set of proposals
async function roundCritique(agents, question, current) {
  const prompt = buildPrompt(
    PROMPTS.critique,
    question,
    { current_proposals: current },
    agents,
  );
  const results = await Promise.all(
    agents.map(async (a) => {
      const res = await spawnAgent(a, prompt, 300, "critique");
      return { agentId: a.id, res };
    }),
  );

  return results;
}

// Revision phase: agents revise their proposals in response to peer critiques
async function roundRevise(agents, question, current, critiques) {
  // Convert critiques array to a map for easier lookup
  const critiqueMap = new Map(
    critiques.map((c) => [c.agentId, c.res?.json?.critiques || []]),
  );

  const results = await Promise.all(
    agents.map(async (a) => {
      // Find this agent's original proposal
      const originalProposal = current.find((p) => p.agentId === a.id);
      if (!originalProposal) {
        return {
          agentId: a.id,
          res: { ok: false, error: "No proposal found for agent" },
        };
      }

      // Collect critiques that this agent received
      const receivedCritiques = [];
      for (const [criticId, critsForThisAgent] of critiqueMap) {
        // Each critique object has {target_agent_id, severity, detail}
        const relevantCritiques = critsForThisAgent.filter(
          (c) => c.target_agent_id === a.id,
        );
        for (const crit of relevantCritiques) {
          receivedCritiques.push({
            from_agent_id: criticId,
            ...crit,
          });
        }
      }

      // Build prompt with original proposal and critiques
      const prompt = buildPrompt(
        PROMPTS.revise,
        question,
        {
          your_proposal: originalProposal.payload,
          critiques_received: receivedCritiques,
        },
        agents,
      );

      const res = await spawnAgent(a, prompt, 300, "revise");
      return { agentId: a.id, res };
    }),
  );

  return results;
}

// Voting phase: each agent votes on all current proposals
async function roundVote(agents, question, current) {
  const prompt = buildPrompt(
    PROMPTS.vote,
    question,
    { current_proposals: current },
    agents,
  );
  const results = await Promise.all(
    agents.map(async (a) => {
      const res = await spawnAgent(a, prompt, 300, "vote");
      return { agentId: a.id, res };
    }),
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
  LOGGER.line(
    {
      id: "orchestrator",
      avatar: "🗂️",
      displayName: "Orchestrator",
      color: "white",
    },
    "phase",
    `Session start - ${agents.length} agents`,
  );

  if (!LOGGER.quiet) {
    console.log(
      paint(
        `Owners: ${OWNER.ids.length ? OWNER.ids.join(", ") : "none"} | ownerMin=${OWNER.minScore} | ownerMode=${OWNER.mode}\n`,
        "gray",
      ),
    );
    console.log(
      paint(
        `Consensus=${consensusMode} | thresholds: U=${CONSENSUS.unanimousPct} S=${CONSENSUS.superMajorityPct} M=${CONSENSUS.majorityPct} | blockers=${CONSENSUS.requireNoBlockers ? "strict" : "allowed"} | rubberPenalty=${DELIB.weightPenaltyRubberStamp}\n`,
        "gray",
      ),
    );
  }

  // Log the question
  LOGGER.line(
    {
      id: "orchestrator",
      avatar: "🗂️",
      displayName: "Orchestrator",
      color: "white",
    },
    "question",
    userQuestion,
  );

  // Round 0: initial proposals
  LOGGER.blockTitle("Initial Proposals ......");
  LOGGER.line(
    {
      id: "orchestrator",
      avatar: "🗂️",
      displayName: "Orchestrator",
      color: "white",
    },
    "phase",
    "Round 0 - Initial proposals",
  );

  // Show agents are working on their proposals
  for (const agent of agents) {
    LOGGER.line(agent, "", "Crafting my solution approach...");
  }

  const r0 = await roundPropose(agents, userQuestion);

  // Check for interruption
  if (checkInterruption(null, true)) {
    return;
  }

  const okR0 = r0.filter((x) => x.res && x.res.ok);
  if (!okR0.length) {
    console.error("No proposals received. Aborting.");
    process.exit(1);
  }

  // Prepare state: list of current proposals per agent
  let current = okR0.map((p) => ({ agentId: p.agentId, payload: p.res.json }));
  // Set of seen critique pairs for novelty scoring
  let seenPairs = new Set();

  // Critique/vote rounds
  for (let round = 1; round <= maxRounds; round++) {
    LOGGER.blockTitle(`Round ${round}: critiques & voting`);
    LOGGER.line(
      {
        id: "orchestrator",
        avatar: "🗂️",
        displayName: "Orchestrator",
        color: "white",
      },
      "phase",
      `Round ${round} - Critiques & voting`,
    );

    // Show agents are working on critiques
    for (const agent of agents) {
      LOGGER.line(agent, "", "Reviewing peer proposals...");
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
        const idx = current.findIndex((p) => p.agentId === rev.agentId);
        if (idx >= 0) {
          const originalPayload = current[idx].payload;
          const revisionPayload = rev.res.json;

          // If revised.proposal is "no change", preserve the original proposal
          if (revisionPayload.revised?.proposal === "no change") {
            // Copy the original proposal into the revised structure
            revisionPayload.revised.proposal =
              originalPayload.proposal ||
              originalPayload.revised?.proposal ||
              "No proposal";
          }

          current[idx].payload = revisionPayload;
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
    const okVotes = votes.filter((v) => v.res && v.res.ok);
    if (okVotes.length === 0) {
      LOGGER.blockTitle("No votes received, continuing...");
      LOGGER.line(
        {
          id: "orchestrator",
          avatar: "🗂️",
          displayName: "Orchestrator",
          color: "white",
        },
        "warn",
        "No votes received in this round",
      );
      continue;
    }

    // Calculate vote tallies
    const tallies = calculateVoteTallies(current, okVotes);

    // Check consensus
    const threshold =
      consensusMode === "unanimous"
        ? CONSENSUS.unanimousPct
        : consensusMode === "super"
          ? CONSENSUS.superMajorityPct
          : CONSENSUS.majorityPct;

    const maxScore = Math.max(
      ...Array.from(tallies.values()).map((t) => t.score),
    );
    const normalizedMaxScore = maxScore / okVotes.length;

    LOGGER.blockTitle(
      `Consensus check: ${normalizedMaxScore.toFixed(2)} vs threshold ${threshold}`,
    );
    LOGGER.line(
      {
        id: "orchestrator",
        avatar: "🗂️",
        displayName: "Orchestrator",
        color: "white",
      },
      "vote",
      `Consensus check: ${normalizedMaxScore.toFixed(2)} vs threshold ${threshold}`,
    );

    if (normalizedMaxScore >= threshold) {
      // Find winning proposal
      const winnerId = Array.from(tallies.entries()).find(
        ([id, tally]) => tally.score === maxScore,
      )?.[0];

      const winner = current.find((p) => p.agentId === winnerId);

      // Check owner approval if required
      const approvalResult = checkOwnerApproval(winnerId, okVotes);
      logOwnerApproval(approvalResult, agents, winnerId);

      if (!approvalResult.approved) {
        continue; // Try next round
      }

      LOGGER.blockTitle(`✅ Consensus reached! Winner: ${winnerId}`);
      LOGGER.line(
        orchestrator,
        "consensus",
        `Consensus reached with ${winnerId} - score: ${normalizedMaxScore.toFixed(2)}`,
      );

      // Debug: log winner structure
      const orchestrator = {
        id: "orchestrator",
        displayName: "Orchestrator",
        avatar: "⚔️",
      };
      LOGGER.line(
        orchestrator,
        "debug",
        `Winner payload keys: ${Object.keys(winner.payload || {}).join(", ")}`,
        true,
      );
      LOGGER.line(
        orchestrator,
        "debug",
        `Winner payload: ${JSON.stringify(winner.payload)}`,
        true,
      );

      // Extract the winning payload (either direct or revised)
      const winningPayload = winner.payload.revised || winner.payload;

      // Format final answer using helper function
      const finalAnswer = formatFinalAnswer(winningPayload);

      // Format and log the final result
      LOGGER.blockTitle("===== FINAL ANSWER =====");
      LOGGER.line(orchestrator, "result", finalAnswer);
      LOGGER.blockTitle("========================");

      return finalAnswer;
    }
  }

  // No consensus reached
  LOGGER.blockTitle("❌ No consensus reached after maximum rounds");
  LOGGER.line(
    orchestrator,
    "consensus",
    `No consensus reached after ${maxRounds} rounds`,
  );

  // Return the highest-scored proposal
  const tallies = new Map();
  for (const agentId of current.map((p) => p.agentId)) {
    tallies.set(agentId, { score: 0 });
  }

  // Recalculate final tallies
  const maxScore = Math.max(
    ...Array.from(tallies.values()).map((t) => t.score),
  );
  const winnerId = Array.from(tallies.entries()).find(
    ([id, tally]) => tally.score === maxScore,
  )?.[0];

  const winner = current.find((p) => p.agentId === winnerId);

  // Extract the winning payload (either direct or revised)
  const winningPayload = winner?.payload.revised || winner?.payload;

  // Format final answer using helper function
  const finalAnswer = formatFinalAnswer(winningPayload);

  // Format and log the result
  const orchestrator = {
    id: "orchestrator",
    displayName: "Orchestrator",
    avatar: "⚔️",
  };
  LOGGER.blockTitle("===== BEST CANDIDATE =====");
  LOGGER.line(
    orchestrator,
    "result",
    `Best proposal from ${winnerId}:\n${finalAnswer}`,
  );
  LOGGER.blockTitle("==========================");

  return finalAnswer;
}
