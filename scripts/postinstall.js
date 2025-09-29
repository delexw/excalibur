#!/usr/bin/env node
/**
 * Post-install script for Excalibur CLI
 * Creates ~/.excalibur/agents.json config file for global installs
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function setupUserConfig() {
  try {
    // Create ~/.excalibur directory
    const excaliburDir = path.join(os.homedir(), '.excalibur');
    fs.mkdirSync(excaliburDir, { recursive: true });

    // Define source and destination paths
    const sourceConfig = path.join(__dirname, '..', 'agents.json');
    const userConfig = path.join(excaliburDir, 'agents.json');

    // Only copy if user config doesn't exist (don't overwrite existing configs)
    if (!fs.existsSync(userConfig)) {
      if (fs.existsSync(sourceConfig)) {
        fs.copyFileSync(sourceConfig, userConfig);
        console.log('✅ Excalibur config created at ~/.excalibur/agents.json');
        console.log('   Edit this file to configure your AI agents');
        console.log('   Run "excalibur --config" to see configuration options');
      } else {
        console.warn('⚠️  Warning: Could not find agents.json to copy');
      }
    } else {
      console.log('ℹ️  Excalibur config already exists at ~/.excalibur/agents.json');
    }
  } catch (error) {
    // Silently ignore errors during global installs as we might not have write permissions
    // or the install environment might be restrictive
    if (process.env.DEBUG) {
      console.error('Excalibur postinstall error:', error.message);
    }
  }
}

// Only run if this script is executed directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  setupUserConfig();
}

export { setupUserConfig };