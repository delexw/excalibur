#!/usr/bin/env node
/**
 * Multi‑agent orchestration CLI with debate, critique, voting and consensus.
 *
 * This script coordinates a panel of AI model CLIs, runs structured
 * discussions (proposal → critique → vote), and synthesises a final
 * answer.  It supports configurable consensus thresholds (unanimous,
 * super‑majority, majority), presets for team‑like behaviour, optional
 * code‑owner approvals and detailed logging.
 *
 * Usage:
 *   node index.js "Your question here" [--maxRounds=5] [--consensus=super] [--preset=team]
 *   Flags:
 *     --maxRounds=N        Maximum rounds of critique/vote cycles (default 5)
 *     --consensus=MODE     unanimous|super|majority (default super)
 *     --preset=NAME        strict|default|fast|experiment|team
 *     --unanimousPct=X     Override unanimous threshold (0–1)
 *     --superMajorityPct=X Override super majority threshold (0–1)
 *     --majorityPct=X      Override simple majority threshold (0–1)
 *     --allow-blockers     Allow consensus even with unresolved blocker critiques
 *     --rubberPenalty=X    Penalty weight (0–1) for rubber‑stamping agents
 *     --owner=ID1,ID2,...  Require one or more agents to approve the winner
 *     --ownerMin=X         Minimum score required from owners (default 0.8)
 *     --ownerMode=any|all  Require any or all owners to approve (default any)
 *     --logDir=DIR         Directory for session logs (default "logs")
 *     --sessionTag=TAG      Custom tag for this session
 *     --quiet              Suppress console logs (still writes log files)
 *     --no-color           Disable ANSI colour output
 *
 * See README.md for more details.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
// Additional imports to support file resolution and external helpers
import { fileURLToPath } from 'node:url';
import { ANSI, ConversationLogger } from './logger.js';

// ----- CLI argument parsing -------------------------------------------------
const argv = process.argv.slice(2);
if (!argv.length) {
  console.error('Usage: node index.js "Your question" [--maxRounds=N] [--consensus=super] ...');
  process.exit(1);
}

// Helper to pick the first non‑flag argument as the user question
const userQuestion = argv.find(a => !a.startsWith('--'));
// Helpers to read numeric and string flags
function numFlag(name, def) {
  const v = (argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1];
  return v ? Number(v) : def;
}
function strFlag(name, def) {
  const v = (argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1];
  return v || def;
}

// Consensus mode (unanimous|super|majority); default super
const consensusMode = strFlag('consensus', 'super');
// Maximum critique/vote rounds; default 5
const maxRounds = numFlag('maxRounds', 5);

// ----- Logging configuration -----------------------------------------------
const LOG = {
  dir: strFlag('logDir', 'logs'),
  session: strFlag('sessionTag', new Date().toISOString().replace(/[:.]/g, '-')),
  noColor: argv.includes('--no-color'),
  quiet: argv.includes('--quiet'),
};

// Legacy inline ANSI and ConversationLogger removed in favour of imported versions.

// Resolve this module's directory to locate prompt files
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load prompts from markdown files within the prompts directory
const PROMPT_DIR = path.join(__dirname, 'prompts');
const PROMPTS = {
  propose: fs.readFileSync(path.join(PROMPT_DIR, 'propose.md'), 'utf8').trim(),
  critique: fs.readFileSync(path.join(PROMPT_DIR, 'critique.md'), 'utf8').trim(),
  vote: fs.readFileSync(path.join(PROMPT_DIR, 'vote.md'), 'utf8').trim(),
};

// Colour wrapper helpers using imported ANSI and the noColor flag
const paint = (txt, colour) => ANSI.paint(txt, colour, LOG.noColor);
const boldify = (txt) => ANSI.boldify(txt, LOG.noColor);

// Global conversation logger instantiation with colour and quiet options
const LOGGER = new ConversationLogger(LOG.dir, LOG.session, { noColor: LOG.noColor, quiet: LOG.quiet });

// ----- Orchestration parameters -------------------------------------------
// Debate/critique heuristics
const DELIB = {
  minNovelCritiquesPerRound: 1,
  requireMajorOrBlockerWhenWarranted: true,
  blockerSeverity: 'blocker',
  weightPenaltyRubberStamp: 0.5,
};

// Consensus thresholds (defaults); override via flags or presets
const CONSENSUS = {
  unanimousPct: 0.75,
  superMajorityPct: 0.75,
  majorityPct: 0.5,
  requireNoBlockers: true,
};

// Preset definitions; override CONSENSUS and DELIB fields when selected
const PRESETS = {
  strict:     { unanimousPct: 0.85, superMajorityPct: 0.8,  majorityPct: 0.6,  requireNoBlockers: true,  rubberPenalty: 0.35 },
  default:    { unanimousPct: 0.75, superMajorityPct: 0.75, majorityPct: 0.5,  requireNoBlockers: true,  rubberPenalty: 0.5  },
  fast:       { unanimousPct: 0.7,  superMajorityPct: 0.66, majorityPct: 0.5,  requireNoBlockers: false, rubberPenalty: 0.6  },
  experiment: { unanimousPct: 0.6,  superMajorityPct: 0.6,  majorityPct: 0.5,  requireNoBlockers: false, rubberPenalty: 0.7  },
  team:       { unanimousPct: 0.8,  superMajorityPct: 0.75, majorityPct: 0.55, requireNoBlockers: true,  rubberPenalty: 0.35 },
};
// Apply preset if specified
const presetName = strFlag('preset', '');
if (presetName && PRESETS[presetName]) {
  const p = PRESETS[presetName];
  CONSENSUS.unanimousPct = p.unanimousPct;
  CONSENSUS.superMajorityPct = p.superMajorityPct;
  CONSENSUS.majorityPct = p.majorityPct;
  CONSENSUS.requireNoBlockers = p.requireNoBlockers;
  DELIB.weightPenaltyRubberStamp = p.rubberPenalty;
}

// Override consensus thresholds and penalties via flags
CONSENSUS.unanimousPct     = numFlag('unanimousPct',     CONSENSUS.unanimousPct);
CONSENSUS.superMajorityPct = numFlag('superMajorityPct', CONSENSUS.superMajorityPct);
CONSENSUS.majorityPct      = numFlag('majorityPct',      CONSENSUS.majorityPct);
DELIB.weightPenaltyRubberStamp = numFlag('rubberPenalty', DELIB.weightPenaltyRubberStamp);
// allow-blockers flag disables requireNoBlockers
if (argv.includes('--allow-blockers')) {
  CONSENSUS.requireNoBlockers = false;
}

// Owner approval flags
const OWNER = {
  ids: (strFlag('owner', '').trim() ? strFlag('owner', '').split(',').map(s => s.trim()).filter(Boolean) : []),
  minScore: numFlag('ownerMin', 0.8),
  mode: (strFlag('ownerMode', 'any') === 'all' ? 'all' : 'any'),
};



// ----- Helpers -------------------------------------------------------------
// Extract the JSON body from agent output by trimming to outer braces
function normalizeJsonText(txt) {
  const first = txt.indexOf('{');
  const last = txt.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return txt.slice(first, last + 1).trim();
  }
  return txt.trim();
}

// Build a prompt for an agent with optional context
function buildPrompt(base, question, context = {}) {
  return `${base}\n\nUSER QUESTION:\n${question}\n\nCONTEXT:\n${JSON.stringify(context, null, 2)}\n\nReturn JSON only.`;
}

// Load agents from agents.json, assigning default avatars/colours if missing
function loadAgents() {
  const agentsPath = path.join(process.cwd(), 'agents.json');
  if (!fs.existsSync(agentsPath)) throw new Error('Missing agents.json');
  const list = JSON.parse(fs.readFileSync(agentsPath, 'utf8'));
  if (!Array.isArray(list) || list.length === 0) throw new Error('agents.json has no agents');
  const palette = ['cyan','magenta','yellow','green','blue','red'];
  const emojis  = ['🦉','🔷','🧭','🧠','🦊','🐙','🛰️','🛠️','🐺','🐍'];
  return list.map((cfg, i) => ({
    avatar: cfg.avatar || emojis[i % emojis.length],
    color:  cfg.color  || palette[i % palette.length],
    ...cfg,
  }));
}

// Spawn an agent CLI process with prompt; return JSON output or error
async function spawnAgent(agent, prompt, timeoutSec) {
  return new Promise((resolve) => {
    const args = (agent.args || []).map(a => a.replace('{PROMPT}', prompt));
    let child;
    try {
      child = spawn(agent.cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      // Failed to spawn (e.g. command not found). Resolve immediately
      resolve({ ok: false, error: `Failed to spawn ${agent.cmd}: ${err.message}` });
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, Math.min(agent.timeoutMs || timeoutSec * 1000, timeoutSec * 1000));
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    // Handle spawn error events
    child.on('error', err => {
      clearTimeout(timer);
      resolve({ ok: false, error: `Spawn error: ${err.message}` });
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 && !stdout.trim()) {
        resolve({ ok: false, error: `Exited with code ${code}: ${stderr}` });
      } else {
        try {
          const json = JSON.parse(normalizeJsonText(stdout));
          resolve({ ok: true, json, raw: stdout });
        } catch {
          resolve({ ok: false, error: 'Non‑JSON or parse error', raw: stdout });
        }
      }
    });
    if ((agent.inputMode || 'stdin') === 'stdin') {
      child.stdin.write(prompt);
      child.stdin.end();
    }
  });
}

// Round: proposals — run propose prompt for each agent
async function roundPropose(agents, question) {
  return Promise.all(agents.map(async (agent) => {
    const prompt = buildPrompt(PROMPTS.propose, question);
    LOGGER.line(agent, 'prompt:propose', 'Sent proposal prompt');
    const res = await spawnAgent(agent, prompt, 60);
    if (!res.ok) {
      LOGGER.line(agent, 'error', res.error || 'Unknown error');
      return { agentId: agent.id, error: res.error, raw: res.raw };
    }
    LOGGER.line(agent, 'proposal', (res.json.proposal || res.json.answer || 'JSON received').slice(0, 400));
    return { agentId: agent.id, res };
  }));
}

// Round: critique — each agent reviews peers and can revise
async function roundCritique(agents, question, current) {
  const extras = { proposals: current.map(p => ({ agentId: p.agentId, ...p.payload })) };
  return Promise.all(agents.map(async (agent) => {
    const orig = current.find(p => p.agentId === agent.id)?.payload || {};
    const context = { ...extras, your_original: orig };
    const prompt = buildPrompt(PROMPTS.critique, question, context);
    LOGGER.line(agent, 'prompt:critique', 'Sent critique prompt with peers');
    const res = await spawnAgent(agent, prompt, 60);
    if (!res.ok) {
      LOGGER.line(agent, 'error', res.error || 'Unknown error');
      return { agentId: agent.id, error: res.error, raw: res.raw };
    }
    const nCrit = (res.json.critiques || []).length;
    const nBlock = (res.json.critiques || []).filter(c => c.severity === 'blocker').length;
    LOGGER.line(agent, 'critique', `critiques=${nCrit}, blockers=${nBlock}`);
    return { agentId: agent.id, res };
  }));
}

// Round: vote — each agent scores candidates
async function roundVote(agents, question, current) {
  const extras = { candidates: current.map(c => ({ agentId: c.agentId, payload: c.payload })) };
  return Promise.all(agents.map(async (agent) => {
    const prompt = buildPrompt(PROMPTS.vote, question, extras);
    LOGGER.line(agent, 'prompt:vote', 'Sent vote prompt for candidates');
    const res = await spawnAgent(agent, prompt, 60);
    if (!res.ok) {
      LOGGER.line(agent, 'error', res.error || 'Unknown error');
      return { agentId: agent.id, error: res.error, raw: res.raw };
    }
    const n = (res.json.scores || []).length;
    LOGGER.line(agent, 'vote', `scored ${n} candidates`);
    return { agentId: agent.id, res };
  }));
}

// Novelty score: count new critique pairs (target|severity|claim) to discourage repeats
function noveltyScore(critiques, seen) {
  let novel = 0;
  for (const c of (critiques || [])) {
    const key = `${c.target_agent}|${c.severity}|${(c.claim_or_line || '').slice(0, 40)}`;
    if (!seen.has(key)) {
      novel++;
      seen.add(key);
    }
  }
  return { novel, seen };
}

// Identify rubber‑stampers: those who always upvote without critiquing
function detectRubberStamp(voteJson, critJson) {
  const allHigh = (voteJson.scores || []).every(s => s.score >= 0.8);
  const noCrit = !(critJson.critiques || []).length;
  return allHigh && noCrit;
}

// Aggregate vote results: compute weighted averages and collect blocker issues and rater scores
function aggregateVotes(votes, agents, crits) {
  const weights = new Map(agents.map(a => [a.id, 1]));
  // Reduce weight for rubber‑stampers
  for (const v of votes) {
    const rubber = detectRubberStamp(v.res.json || {}, (crits.find(c => c.agentId === v.agentId) || {}).res?.json || {});
    if (rubber) weights.set(v.agentId, DELIB.weightPenaltyRubberStamp);
  }
  const scores = new Map();
  const counts = new Map();
  const blockers = new Map();
  const raterScores = new Map();
  for (const v of votes) {
    const rater = v.agentId;
    const weight = weights.get(rater) || 1;
    const json = v.res.json || {};
    for (const s of (json.scores || [])) {
      // accumulate weighted sum
      scores.set(s.agent_id, (scores.get(s.agent_id) || 0) + weight * s.score);
      counts.set(s.agent_id, (counts.get(s.agent_id) || 0) + weight);
      // record per rater for owner approvals
      let map = raterScores.get(s.agent_id);
      if (!map) {
        map = new Map();
        raterScores.set(s.agent_id, map);
      }
      const list = map.get(rater) || [];
      list.push(s.score);
      map.set(rater, list);
    }
    for (const b of (json.blocking_issues || [])) {
      const arr = blockers.get(b.agent_id) || [];
      arr.push(b.issue);
      blockers.set(b.agent_id, arr);
    }
  }
  // Compute averages
  const avg = Array.from(scores.entries()).map(([id, sum]) => {
    const c = counts.get(id) || 1;
    return { agentId: id, avg: sum / c, blockers: blockers.get(id) || [] };
  }).sort((a, b) => b.avg - a.avg);
  // Compress raterScores: average duplicates for same rater
  for (const [cand, m] of raterScores.entries()) {
    for (const [rater, arr] of m.entries()) {
      m.set(rater, arr.reduce((a, b) => a + b, 0) / arr.length);
    }
  }
  return { avg, weights, blockers, raterScores };
}

// Determine if consensus is reached given averages and mode
function consensusReached(avg, mode) {
  if (!avg.length) return null;
  const top = avg[0];
  // Blocker veto
  if (CONSENSUS.requireNoBlockers && top.blockers.length) return null;
  if (mode === 'unanimous') {
    const minAvg = avg[avg.length - 1]?.avg ?? 0;
    return minAvg >= CONSENSUS.unanimousPct ? top : null;
  }
  if (mode === 'super') {
    return top.avg >= CONSENSUS.superMajorityPct ? top : null;
  }
  // majority
  return top.avg >= CONSENSUS.majorityPct ? top : null;
}

// ----- Main execution ------------------------------------------------------
(async function main() {
  const agents = loadAgents();
  // Display session configuration
  LOGGER.blockTitle(`Session ${LOG.session} — ${agents.length} agents`);
  if (!LOG.quiet) {
    const presetInfo = presetName ? `preset=${presetName} | ` : '';
    console.log(paint(`Owners: ${OWNER.ids.length ? OWNER.ids.join(', ') : 'none'} | ownerMin=${OWNER.minScore} | ownerMode=${OWNER.mode}\n`, 'gray'));
    console.log(paint(`Consensus=${consensusMode} | thresholds: U=${CONSENSUS.unanimousPct} S=${CONSENSUS.superMajorityPct} M=${CONSENSUS.majorityPct} | blockers=${CONSENSUS.requireNoBlockers ? 'strict' : 'allowed'} | rubberPenalty=${DELIB.weightPenaltyRubberStamp}\n`, 'gray'));
  }
  // Log the question
  LOGGER.line({ id: 'orchestrator', avatar: '🗂️', displayName: 'Orchestrator', color: 'white' }, 'question', userQuestion);

  // Round 0: initial proposals
  const r0 = await roundPropose(agents, userQuestion);
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
    // Critique phase
    const crits = await roundCritique(agents, userQuestion, current);
    const okCrits = crits.filter(x => x.res && x.res.ok);
    // Novelty check across all agents
    let totalNovel = 0;
    for (const c of okCrits) {
      const { novel, seen } = noveltyScore(c.res.json.critiques, seenPairs);
      totalNovel += novel;
      seenPairs = seen;
    }
    // Apply revisions from critiques
    for (const c of okCrits) {
      const revised = c.res.json.revised;
      if (revised && revised.proposal && revised.proposal !== 'no change') {
        const idx = current.findIndex(x => x.agentId === c.agentId);
        if (idx >= 0) current[idx].payload = revised;
      }
    }
    // Voting phase
    const votes = await roundVote(agents, userQuestion, current);
    const okVotes = votes.filter(v => v.res && v.res.ok);
    const { avg, raterScores } = aggregateVotes(okVotes, agents, okCrits);
    // Check consensus
    const winner = consensusReached(avg, consensusMode);
    if (winner) {
      // Owner approval enforcement, if configured
      if (OWNER.ids.length) {
        const candId = winner.agentId;
        const raters = raterScores.get(candId) || new Map();
        const hits = OWNER.ids.filter(ownerId => (raters.get(ownerId) ?? -Infinity) >= OWNER.minScore);
        const ownersSatisfied = OWNER.mode === 'all' ? (hits.length === OWNER.ids.length) : (hits.length >= 1);
        if (!ownersSatisfied) {
          console.log(paint(`\n🔒 Owner approval not satisfied for winner ${candId}. Required: ${OWNER.mode.toUpperCase()} of [${OWNER.ids.join(', ')}] with score ≥ ${OWNER.minScore}. Got approvals from [${hits.join(', ')}]. Continuing rounds...\n`, 'yellow'));
          continue;
        }
      }
      // Consensus achieved
      const winnerPayload = current.find(c => c.agentId === winner.agentId)?.payload;
      console.log('\n✅ CONSENSUS REACHED on', winner.agentId, `(avg=${winner.avg.toFixed(2)})\n`);
      console.log('===== FINAL ANSWER =====\n');
      console.log(winnerPayload.proposal || '(no proposal)');
      if (winnerPayload.code_patch) {
        console.log('\n--- code_patch (unified diff) ---\n');
        console.log(winnerPayload.code_patch);
      }
      if (winnerPayload.tests && winnerPayload.tests.length) {
        console.log('\nTests to run:\n- ' + winnerPayload.tests.join('\n- '));
      }
      console.log('\nKey points:\n- ' + (winnerPayload.key_points || []).join('\n- '));
      console.log('\nConfidence:', winnerPayload.confidence || 'low');
      console.log('\n========================\n');
      // Build scorecards summary
      const scorecards = agents.map(a => {
        const nov = okCrits.find(x => x.agentId === a.id)?.res.json?.critiques?.length || 0;
        const blk = okCrits.find(x => x.agentId === a.id)?.res.json?.critiques?.filter(c => c.severity === 'blocker').length || 0;
        const isRubber = !okCrits.find(x => x.agentId === a.id) && okVotes.find(x => x.agentId === a.id);
        return {
          agentId: a.id,
          displayName: a.displayName,
          avatar: a.avatar,
          novelCritiques: nov,
          blockers: blk,
          rubber: isRubber,
          avgPeerScore: undefined, // could be filled via raterScores
        };
      });
      LOGGER.summary(scorecards);
      LOGGER.end();
      return;
    }
  }
  // No consensus reached within maxRounds; fallback to best candidate
  LOGGER.blockTitle('Max rounds reached — selecting highest scoring proposal');
  // Recompute votes to show final ranking
  const finalVotes = await roundVote(agents, userQuestion, current);
  const okFinalVotes = finalVotes.filter(v => v.res && v.res.ok);
  const { avg: finalAvg } = aggregateVotes(okFinalVotes, agents, []);
  if (!finalAvg.length) {
    console.error('No votes tallied. Aborting.');
    return;
  }
  const top = finalAvg[0];
  const winnerPayload = current.find(c => c.agentId === top.agentId)?.payload;
  console.log('\n⚖️  No consensus. Selecting highest scoring proposal.\n');
  console.log('===== FINAL (NO CONSENSUS) =====\n');
  console.log(winnerPayload.proposal || '(no proposal)');
  if (winnerPayload.code_patch) {
    console.log('\n--- code_patch (unified diff) ---\n');
    console.log(winnerPayload.code_patch);
  }
  if (winnerPayload.tests && winnerPayload.tests.length) {
    console.log('\nTests to run:\n- ' + winnerPayload.tests.join('\n- '));
  }
  console.log('\nRankings:', finalAvg.map(x => `${x.agentId}:${x.avg.toFixed(2)}`).join('  '));
  // Collect dissent notes from blockers map if available
  // (Simplified: could list issues but not computed here)
  console.log('\n===============================\n');
  // Build scorecards summary for fallback case (counts zero for critiques)
  const scorecards = agents.map(a => ({
    agentId: a.id,
    displayName: a.displayName,
    avatar: a.avatar,
    novelCritiques: 0,
    blockers: 0,
    rubber: false,
    avgPeerScore: undefined,
  }));
  LOGGER.summary(scorecards);
  LOGGER.end();
})();