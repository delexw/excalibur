/**
 * Config - Configuration management for Excalibur CLI
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export class Config {
  constructor(argv = process.argv.slice(2)) {
    this.argv = argv;
    this.settings = this.parse();
    this._loadAgents();
    this._loadPrompts();
  }

  _loadPrompts() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const PROMPT_DIR = path.join(__dirname, "..", "prompts");
    
    this.settings.sysPrompts = {
      propose: fs.readFileSync(path.join(PROMPT_DIR, "propose.md"), "utf8").trim(),
      critique: fs.readFileSync(path.join(PROMPT_DIR, "critique.md"), "utf8").trim(),
      revise: fs.readFileSync(path.join(PROMPT_DIR, "revise.md"), "utf8").trim(),
      vote: fs.readFileSync(path.join(PROMPT_DIR, "vote.md"), "utf8").trim(),
      actionAgree: fs.readFileSync(path.join(PROMPT_DIR, "action-agree.md"), "utf8").trim(),
      actionExecute: fs.readFileSync(path.join(PROMPT_DIR, "action-execute.md"), "utf8").trim(),
    };
  }

  getOrchestrator() {
    return this.settings.orchestrator;
  }

  getPrompts() {
    return this.settings.sysPrompts;
  }

  get(key) {
    const keys = key.split('.');
    let value = this.settings;
    for (const k of keys) {
      value = value?.[k];
    }
    return value;
  }

  parse() {
    const numFlag = (name, def) => {
      const v = (this.argv.find((a) => a.startsWith(`--${name}=`)) || "").split("=")[1];
      return v ? Number(v) : def;
    };

    const strFlag = (name, def) => {
      const v = (this.argv.find((a) => a.startsWith(`--${name}=`)) || "").split("=")[1];
      return v || def;
    };

    const PRESETS = {
      strict: { unanimousPct: 0.85, superMajorityPct: 0.8, majorityPct: 0.6, requireNoBlockers: true, rubberPenalty: 0.35, responseThreshold: 0.8 },
      default: { unanimousPct: 0.75, superMajorityPct: 0.75, majorityPct: 0.5, requireNoBlockers: true, rubberPenalty: 0.5, responseThreshold: 0.8 },
      fast: { unanimousPct: 0.7, superMajorityPct: 0.66, majorityPct: 0.5, requireNoBlockers: false, rubberPenalty: 0.6, responseThreshold: 0.8 },
      experiment: { unanimousPct: 0.6, superMajorityPct: 0.6, majorityPct: 0.5, requireNoBlockers: false, rubberPenalty: 0.7, responseThreshold: 0.8 },
      team: { unanimousPct: 0.8, superMajorityPct: 0.75, majorityPct: 0.55, requireNoBlockers: true, rubberPenalty: 0.35, responseThreshold: 0.8 },
    };

    // Start with default preset
    let activePreset = { ...PRESETS.default };

    // Apply preset if specified
    const presetName = strFlag("preset", "");
    if (presetName && PRESETS[presetName]) {
      activePreset = { ...PRESETS[presetName] };
    }

    // Override via flags
    activePreset.unanimousPct = numFlag("unanimousPct", activePreset.unanimousPct);
    activePreset.superMajorityPct = numFlag("superMajorityPct", activePreset.superMajorityPct);
    activePreset.majorityPct = numFlag("majorityPct", activePreset.majorityPct);
    activePreset.rubberPenalty = numFlag("rubberPenalty", activePreset.rubberPenalty);
    activePreset.responseThreshold = numFlag("responseThreshold", activePreset.responseThreshold);
    activePreset.requireNoBlockers = this.argv.includes("--allow-blockers") ? false : activePreset.requireNoBlockers;

    const ownerStr = strFlag("owner", "");
    const ownerIds = ownerStr.trim() ? ownerStr.split(",").map(s => s.trim()).filter(Boolean) : [];

    const config = {
      consensusMode: strFlag("consensus", "super"),
      maxRounds: numFlag("maxRounds", 5),
      consensus: {
        unanimousPct: activePreset.unanimousPct,
        superMajorityPct: activePreset.superMajorityPct,
        majorityPct: activePreset.majorityPct,
        requireNoBlockers: activePreset.requireNoBlockers,
        rubberPenalty: activePreset.rubberPenalty,
        responseThreshold: activePreset.responseThreshold,
      },
      owner: {
        ids: ownerIds,
        minScore: numFlag("ownerMin", 0.8),
        mode: strFlag("ownerMode", "any") === "all" ? "all" : "any",
      },
      log: {
        dir: strFlag("logDir", "logs"),
        session: strFlag("sessionTag", new Date().toISOString().replace(/[:.]/g, "-")),
        noColor: this.argv.includes("--no-color"),
        quiet: this.argv.includes("--quiet"),
      },
    };

    return config;
  }

  hasFlag(flag) {
    return this.argv.includes(flag);
  }

  getQuestion() {
    return this.argv.find((a) => !a.startsWith("--"));
  }

  applyRuntime(newConfig) {
    if (!newConfig) return this.settings;

    if (newConfig.consensus) {
      this.settings.consensusMode = newConfig.consensus;
    }
    if (typeof newConfig.maxRounds === 'number') {
      this.settings.maxRounds = newConfig.maxRounds;
    }

    if (typeof newConfig.unanimousPct === 'number') {
      this.settings.consensus.unanimousPct = newConfig.unanimousPct;
    }
    if (typeof newConfig.superMajorityPct === 'number') {
      this.settings.consensus.superMajorityPct = newConfig.superMajorityPct;
    }
    if (typeof newConfig.majorityPct === 'number') {
      this.settings.consensus.majorityPct = newConfig.majorityPct;
    }
    if (typeof newConfig.allowBlockers === 'boolean') {
      this.settings.consensus.requireNoBlockers = !newConfig.allowBlockers;
    }
    if (typeof newConfig.rubberPenalty === 'number') {
      this.settings.consensus.rubberPenalty = newConfig.rubberPenalty;
    }

    if (newConfig.owner && Array.isArray(newConfig.owner)) {
      this.settings.owner.ids = newConfig.owner;
    }
    if (typeof newConfig.ownerMin === 'number') {
      this.settings.owner.minScore = newConfig.ownerMin;
    }
    if (newConfig.ownerMode) {
      this.settings.owner.mode = newConfig.ownerMode === 'all' ? 'all' : 'any';
    }

    return this.settings;
  }

  _getConfigPaths() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    return {
      userConfig: path.join(os.homedir(), ".excalibur", "agents.json"),
      cwdConfig: path.join(process.cwd(), "agents.json"),
      packageConfig: path.join(__dirname, "agents.json"),
    };
  }

  _resolveConfigPath() {
    const paths = this._getConfigPaths();

    if (fs.existsSync(paths.userConfig)) return paths.userConfig;
    if (fs.existsSync(paths.cwdConfig)) return paths.cwdConfig;

    if (fs.existsSync(paths.packageConfig)) {
      try {
        const userConfigDir = path.dirname(paths.userConfig);
        fs.mkdirSync(userConfigDir, { recursive: true });
        fs.copyFileSync(paths.packageConfig, paths.userConfig);
      } catch (e) {}
      return paths.packageConfig;
    }

    throw new Error("Missing agents.json");
  }

  _validateAgents(agents) {
    const errors = [];
    const seenIds = new Set();
    const seenDisplayNames = new Set();

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const prefix = `Agent ${i + 1}`;

      if (!agent.id || typeof agent.id !== "string") {
        errors.push(`${prefix}: missing or invalid 'id' field`);
      }
      if (!agent.displayName || typeof agent.displayName !== "string") {
        errors.push(`${prefix}: missing or invalid 'displayName' field`);
      }
      if (!agent.cmd || typeof agent.cmd !== "string") {
        errors.push(`${prefix}: missing or invalid 'cmd' field`);
      }
      if (!Array.isArray(agent.args)) {
        errors.push(`${prefix}: 'args' must be an array`);
      }

      if (agent.id) {
        if (seenIds.has(agent.id)) {
          errors.push(`${prefix}: duplicate agent id '${agent.id}'`);
        } else {
          seenIds.add(agent.id);
        }
      }

      if (agent.displayName) {
        if (seenDisplayNames.has(agent.displayName)) {
          errors.push(`${prefix}: duplicate displayName '${agent.displayName}'`);
        } else {
          seenDisplayNames.add(agent.displayName);
        }
      }

      if (Array.isArray(agent.args) && !agent.args.some((arg) => arg.includes("{PROMPT}"))) {
        errors.push(`${prefix}: 'args' must contain '{PROMPT}' placeholder`);
      }

      if (agent.timeoutMs !== undefined && (!Number.isInteger(agent.timeoutMs) || agent.timeoutMs <= 0)) {
        errors.push(`${prefix}: 'timeoutMs' must be a positive integer`);
      }

      if (agent.inputMode !== undefined && !["arg", "stdin"].includes(agent.inputMode)) {
        errors.push(`${prefix}: 'inputMode' must be 'arg' or 'stdin'`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`agents.json validation failed:\n  ${errors.join("\n  ")}`);
    }
  }

  _loadAgents() {
    const agentsPath = this._resolveConfigPath();
    const list = JSON.parse(fs.readFileSync(agentsPath, "utf8"));
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error("agents.json has no agents");
    }

    this._validateAgents(list);

    this.agents = list.map((cfg) => ({
      avatar: cfg.avatar || "🤖",
      color: cfg.color || "white",
      ...cfg,
    }));

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const ORCHESTRATION_DIR = path.join(__dirname, "orchestration");
    this.settings.orchestrator = JSON.parse(fs.readFileSync(path.join(ORCHESTRATION_DIR, "orchestrator.json"), "utf8"));
  }

  getAgents() {
    return this.agents;
  }

  getConfigInfo() {
    const paths = this._getConfigPaths();
    let currentConfig = "None found";
    try {
      currentConfig = this._resolveConfigPath();
    } catch {}

    return {
      paths,
      currentConfig,
    };
  }
}
