import fs from 'node:fs';
import path from 'node:path';

/**
 * SessionManager - Responsible for managing session state and configuration
 */
export class SessionManager {
  constructor() {
    this.history = [];
    this.configPath = path.join(process.cwd(), '.excalibur', 'config.json');
    this.defaultConfig = {
      // Core orchestration settings
      preset: 'team',
      consensus: 'super',
      maxRounds: 5,

      // Consensus thresholds
      unanimousPct: 0.75,
      superMajorityPct: 0.75,
      majorityPct: 0.5,

      // Behavioral controls
      allowBlockers: false,
      rubberPenalty: 0.5,

      // Owner approval settings
      owner: [],
      ownerMin: 0.8,
      ownerMode: 'any',

      // Logging and output
      logDir: 'logs',
      sessionTag: '',
      quiet: false,
      noColor: false,

      // UI settings
      blessed: true  // Enable blessed split-pane UI (default: true in interactive mode)
    };
    this.config = { ...this.defaultConfig };
    this.agents = [];

    // Load persistent configuration
    this.loadConfig();
  }

  addToHistory(command, result) {
    this.history.push({
      timestamp: new Date().toISOString(),
      command,
      result: result ? 'success' : 'failed'
    });
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const savedConfig = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        this.config = { ...this.defaultConfig, ...savedConfig };
      }
    } catch (error) {
      console.warn(`⚠️  Failed to load config: ${error.message}`);
      this.config = { ...this.defaultConfig };
    }
  }

  saveConfig() {
    try {
      // Ensure .excalibur directory exists
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      console.log(`💾 Configuration saved to ${this.configPath}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to save config: ${error.message}`);
      return false;
    }
  }

  updateConfig(key, value) {
    if (this.config.hasOwnProperty(key)) {
      this.config[key] = value;
      this.saveConfig(); // Auto-save on update
      return true;
    }
    return false;
  }

  getConfig() {
    return { ...this.config };
  }

  getHistory() {
    return [...this.history];
  }

  setAgents(agents) {
    this.agents = agents;
  }

  getAgents() {
    return [...this.agents];
  }
}
