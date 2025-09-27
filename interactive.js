import readline from 'node:readline';
import { ANSI } from './logger.js';

// SOLID Principle: Single Responsibility - Each class has one clear purpose

/**
 * LogoRenderer - Responsible only for rendering ASCII art logo
 */
export class LogoRenderer {
  constructor(options = {}) {
    this.noColor = options.noColor || false;
  }

  render() {
    const logo = `
███████╗██╗  ██╗ ██████╗ █████╗ ██╗     ██╗██████╗ ██╗   ██╗██████╗
██╔════╝╚██╗██╔╝██╔════╝██╔══██╗██║     ██║██╔══██╗██║   ██║██╔══██╗
█████╗   ╚███╔╝ ██║     ███████║██║     ██║██████╔╝██║   ██║██████╔╝
██╔══╝   ██╔██╗ ██║     ██╔══██║██║     ██║██╔══██╗██║   ██║██╔══██╗
███████╗██╔╝ ██╗╚██████╗██║  ██║███████╗██║██████╔╝╚██████╔╝██║  ██║
╚══════╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝

⚔️  EXCALIBUR CLI - Multi-Agent Orchestration Engine
`;

    if (this.noColor) {
      return logo;
    }

    // Apply Fate/Stay Night inspired colors - deep blues, purples, and gold
    const lines = logo.split('\n');
    return lines.map((line, index) => {
      if (index >= 1 && index <= 6) {
        // Main logo lines get Fate-inspired gradient: blue -> purple -> magenta
        const colors = ['blue', 'blue', 'magenta', 'magenta', 'cyan', 'cyan'];
        const color = colors[index - 1] || 'white';

        // Special handling for the title line with emoji sword
        if (index === 7) {
          // Split emoji and title
          const emojiPart = '⚔️';
          const titlePart = '  EXCALIBUR CLI - Multi-Agent Orchestration Engine';
          return ANSI.paint(emojiPart, 'yellow', this.noColor) +
                 ANSI.paint(titlePart, 'yellow', this.noColor);
        }

        return ANSI.paint(line, color, this.noColor);
      }

      // Handle the title line
      if (line.includes('⚔️')) {
        const emojiPart = '⚔️';
        const titlePart = '  EXCALIBUR CLI - Multi-Agent Orchestration Engine';
        return ANSI.paint(emojiPart, 'yellow', this.noColor) +
               ANSI.paint(titlePart, 'yellow', this.noColor);
      }

      return line;
    }).join('\n');
  }
}

/**
 * CommandParser - Responsible only for parsing and validating commands
 */
export class CommandParser {
  constructor() {
    this.commands = new Map([
      ['/help', { description: 'Show available commands', aliases: ['-h', '/?'] }],
      ['/question', { description: 'Ask a question to agents', aliases: ['-q', 'ask'] }],
      ['/preset', { description: 'Select consensus preset', aliases: ['-p'] }],
      ['/agents', { description: 'List available agents', aliases: ['-a'] }],
      ['/config', { description: 'Show current configuration', aliases: ['-c'] }],
      ['/history', { description: 'Show session history', aliases: ['hist'] }],
      ['/clear', { description: 'Clear terminal screen', aliases: ['cls'] }],
      ['/exit', { description: 'Exit Excalibur CLI', aliases: ['quit'] }]
    ]);
  }

  parse(input) {
    const trimmed = input.trim();
    if (!trimmed) return { command: null, args: [] };

    const parts = trimmed.split(/\s+/);
    const commandInput = parts[0].toLowerCase();
    const args = parts.slice(1);

    // Find command by name or alias
    for (const [name, config] of this.commands) {
      if (name === commandInput || config.aliases.includes(commandInput)) {
        return { command: name, args, raw: trimmed };
      }
    }

    return { command: 'unknown', args, raw: trimmed };
  }

  getCommands() {
    return Array.from(this.commands.entries());
  }
}

/**
 * TerminalDisplay - Responsible only for display formatting and output
 */
export class TerminalDisplay {
  constructor(options = {}) {
    this.noColor = options.noColor || false;
    this.width = process.stdout.columns || 80;
  }

  showWelcome(logo) {
    this.clear();
    console.log(logo);
    console.log(ANSI.paint('\n💡 Welcome to the interactive Excalibur CLI!', 'green', this.noColor));
    console.log(ANSI.paint('   Type "/help" to see commands or just ask any question directly!', 'gray', this.noColor));
    console.log(ANSI.paint('   💡 Tip: Press TAB for auto-completion, "/" for commands, ESC to kill agents', 'gray', this.noColor));
    console.log(ANSI.paint('─'.repeat(this.width), 'gray', this.noColor));
  }

  showHelp(commands) {
    console.log(ANSI.paint('\n📖 Available Commands:', 'cyan', this.noColor));
    console.log(ANSI.paint('─'.repeat(40), 'gray', this.noColor));

    for (const [name, config] of commands) {
      const aliases = config.aliases.length > 0 ? ` (${config.aliases.join(', ')})` : '';
      const commandText = ANSI.paint(`${name}${aliases}`, 'yellow', this.noColor);
      console.log(`  ${commandText.padEnd(20)} - ${config.description}`);
    }

    console.log(ANSI.paint('\n💡 Examples:', 'cyan', this.noColor));
    console.log('  /question "How to optimize database queries?"');
    console.log('  How to implement async/await in Node.js?');
    console.log('  What are the best practices for error handling?');
    console.log('  -p team');
    console.log('  -c');
    console.log('  -h');
    console.log(ANSI.paint('\n⚡ Quick Actions:', 'cyan', this.noColor));
    console.log('  ESC         - Kill all running agents (emergency stop)');
    console.log('  TAB         - Auto-complete commands');
    console.log('  /           - Show all available commands');
    console.log(ANSI.paint('─'.repeat(40), 'gray', this.noColor));
  }

  showError(message) {
    console.log(ANSI.paint(`❌ Error: ${message}`, 'red', this.noColor));
  }

  showSuccess(message) {
    console.log(ANSI.paint(`✅ ${message}`, 'green', this.noColor));
  }

  showInfo(message) {
    console.log(ANSI.paint(`ℹ️  ${message}`, 'blue', this.noColor));
  }

  showSuggestions(partialCommand, commands) {
    const matches = [];
    for (const [name, config] of commands) {
      if (name.startsWith(partialCommand)) matches.push(`${name} - ${config.description}`);
      for (const alias of config.aliases) {
        if (alias.startsWith(partialCommand)) matches.push(`${alias} (${name}) - ${config.description}`);
      }
    }

    if (matches.length > 0 && matches.length <= 5) {
      console.log(ANSI.paint('\n💡 Did you mean:', 'cyan', this.noColor));
      matches.forEach(match => console.log(`  ${match}`));
      console.log('');
      return true;
    }
    return false;
  }

  clear() {
    console.clear();
  }

  createPrompt() {
    return ANSI.paint('⚔️  excalibur', 'cyan', this.noColor) +
           ANSI.paint(' ➤ ', 'yellow', this.noColor);
  }
}

/**
 * SessionManager - Responsible only for managing session state
 */
export class SessionManager {
  constructor() {
    this.history = [];
    this.config = {
      preset: 'team',
      consensus: 'super',
      maxRounds: 5
    };
    this.agents = [];
  }

  addToHistory(command, result) {
    this.history.push({
      timestamp: new Date().toISOString(),
      command,
      result: result ? 'success' : 'failed'
    });
  }

  updateConfig(key, value) {
    if (this.config.hasOwnProperty(key)) {
      this.config[key] = value;
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

/**
 * InteractiveTerminal - Orchestrates all components (SOLID: Dependency Inversion)
 * Depends on abstractions, not concretions
 */
export class InteractiveTerminal {
  constructor(dependencies = {}) {
    this.logoRenderer = dependencies.logoRenderer || new LogoRenderer();
    this.commandParser = dependencies.commandParser || new CommandParser();
    this.display = dependencies.display || new TerminalDisplay();
    this.sessionManager = dependencies.sessionManager || new SessionManager();
    this.questionHandler = dependencies.questionHandler || null;

    this.rl = null;
    this.running = false;

    // Live filter state
    this.filterDisplayActive = false;
    this.currentInput = '';
    this.filteredCommands = [];
    this.selectedIndex = 0;
  }

  async start() {
    // Enable keypress events
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.display.createPrompt(),
      completer: this.createCompleter()
    });

    this.running = true;
    this.display.showWelcome(this.logoRenderer.render());

    // Setup graceful shutdown
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());

    // Add live filtering as user types
    this.setupLiveFiltering();

    // Ensure cursor is visible
    process.stdout.write('\x1b[?25h');

    this.rl.prompt();

    this.rl.on('line', async (input) => {
      if (!this.running) return;

      // If filter is active, ignore this line event (command execution happens via keypress)
      if (this.filterDisplayActive) {
        return;
      }

      // Clear any live filter display before processing command
      this.clearLiveFilter();

      const { command, args, raw } = this.commandParser.parse(input);

      try {
        await this.handleCommand(command, args, raw);
      } catch (error) {
        this.display.showError(error.message);
      }

      if (this.running) {
        this.rl.prompt();
      }
    });

    this.rl.on('close', () => {
      this.shutdown();
    });
  }

  async handleCommand(command, args, raw) {
    switch (command) {
      case null:
        // Empty input, do nothing
        break;

      case '/help':
        this.display.showHelp(this.commandParser.getCommands());
        break;

      case '/question':
        await this.handleQuestion(args.join(' '));
        break;

      case '/preset':
        this.handlePreset(args[0]);
        break;

      case '/agents':
        this.showAgents();
        break;

      case '/config':
        this.showConfig();
        break;

      case '/history':
        this.showHistory();
        break;

      case '/clear':
        this.display.clear();
        this.display.showWelcome(this.logoRenderer.render());
        break;

      case '/exit':
        this.shutdown();
        break;

      case 'unknown':
        // If input doesn't start with / or -, treat it as a question
        if (!raw.startsWith('/') && !raw.startsWith('-')) {
          await this.handleQuestion(raw);
        } else {
          this.display.showError(`Unknown command: ${raw}.`);
          // Show suggestions for partial matches
          const partialCommand = raw.split(' ')[0];
          const commands = this.commandParser.getCommands();
          const foundSuggestions = this.display.showSuggestions(partialCommand, commands);

          if (!foundSuggestions) {
            this.display.showInfo('Type "/help" for all available commands.');
          }
        }
        break;

      default:
        this.display.showError(`Command "${command}" not implemented yet.`);
    }

    this.sessionManager.addToHistory(raw, true);
  }

  async handleQuestion(question) {
    if (!question.trim()) {
      this.display.showError('Please provide a question. Usage: /question "your question here"');
      return;
    }

    this.display.showInfo(`Processing question: "${question}"`);

    if (this.questionHandler) {
      try {
        await this.questionHandler(question, this.sessionManager.getConfig());
        this.display.showSuccess('Question processed successfully!');
      } catch (error) {
        this.display.showError(`Failed to process question: ${error.message}`);
      }
    } else {
      this.display.showError('Question handler not configured. Use non-interactive mode to ask questions.');
    }
  }

  handlePreset(preset) {
    const validPresets = ['strict', 'default', 'fast', 'experiment', 'team'];

    if (!preset) {
      this.display.showInfo(`Current preset: ${this.sessionManager.getConfig().preset}`);
      this.display.showInfo(`Available presets: ${validPresets.join(', ')}`);
      return;
    }

    if (validPresets.includes(preset)) {
      this.sessionManager.updateConfig('preset', preset);
      this.display.showSuccess(`Preset changed to: ${preset}`);
    } else {
      this.display.showError(`Invalid preset: ${preset}. Available: ${validPresets.join(', ')}`);
    }
  }

  showAgents() {
    const agents = this.sessionManager.getAgents();
    if (agents.length === 0) {
      this.display.showInfo('No agents loaded. Agents are loaded when starting a session.');
      return;
    }

    console.log(ANSI.paint('\n🤖 Available Agents:', 'cyan'));
    agents.forEach(agent => {
      const status = ANSI.paint('●', agent.color || 'white');
      console.log(`  ${status} ${agent.avatar || '🤖'} ${agent.displayName || agent.id}`);
    });
  }

  showConfig() {
    const config = this.sessionManager.getConfig();
    console.log(ANSI.paint('\n⚙️  Current Configuration:', 'cyan'));
    console.log(ANSI.paint('─'.repeat(30), 'gray'));

    Object.entries(config).forEach(([key, value]) => {
      const keyText = ANSI.paint(key.padEnd(15), 'yellow');
      console.log(`  ${keyText}: ${value}`);
    });
  }

  showHistory() {
    const history = this.sessionManager.getHistory();
    if (history.length === 0) {
      this.display.showInfo('No command history yet.');
      return;
    }

    console.log(ANSI.paint('\n📜 Command History:', 'cyan'));
    console.log(ANSI.paint('─'.repeat(40), 'gray'));

    history.slice(-10).forEach((entry, index) => {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      const status = entry.result === 'success' ? '✅' : '❌';
      console.log(`  ${status} [${time}] ${entry.command}`);
    });

    if (history.length > 10) {
      console.log(ANSI.paint(`  ... and ${history.length - 10} more entries`, 'gray'));
    }
  }

  shutdown() {
    if (!this.running) return;

    this.running = false;

    // Clear any live filter display
    this.clearLiveFilter();

    console.log(ANSI.paint('\n\n⚔️  Farewell, noble knight! The Round Table awaits your return.', 'cyan'));

    // Restore terminal settings
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }

    if (this.rl) {
      this.rl.close();
    }

    process.exit(0);
  }

  // Create auto-completer for readline
  createCompleter() {
    return (line) => {
      const allCompletions = [];

      // Add all primary commands and their aliases
      for (const [name, config] of this.commandParser.getCommands()) {
        allCompletions.push(name);
        allCompletions.push(...config.aliases);
      }

      // Add some common preset names for /preset command
      if (line.startsWith('/preset ') || line.startsWith('-p ')) {
        const presetCompletions = ['strict', 'default', 'fast', 'experiment', 'team'];
        return [presetCompletions.filter(c => c.startsWith(line.split(' ')[1] || '')), line];
      }

      // Filter completions based on what user has typed
      const hits = allCompletions.filter(c => c.startsWith(line));

      // Show all if no match, or show matches
      return [hits.length ? hits : allCompletions, line];
    };
  }

  // Setup live filtering as user types
  setupLiveFiltering() {
    if (!this.rl) return;

    // Store original output methods
    this.originalWrite = process.stdout.write.bind(process.stdout);

    // Listen for keypress events
    process.stdin.on('keypress', (str, key) => {
      if (!this.running || !key) return;

      // Handle navigation keys when filter is active
      if (this.filterDisplayActive) {
        if (key.name === 'up') {
          this.navigateFilter(-1);
          return;
        }
        if (key.name === 'down') {
          this.navigateFilter(1);
          return;
        }
        if (key.name === 'return') {
          // Prevent the regular line handler from processing this
          this.executeSelectedCommand();
          return;
        }
        if (key.name === 'escape') {
          this.clearLiveFilter();
          return;
        }
      }

      // Handle special keys
      if (key.name === 'return' || key.name === 'tab') {
        this.clearLiveFilter();
        return;
      }

      // Handle escape key - kill all agents and clear everything
      if (key.name === 'escape') {
        this.killAllAgents();
        this.clearLiveFilter();
        return;
      }

      // Update current input based on keypress
      if (key.name === 'backspace') {
        this.currentInput = this.currentInput.slice(0, -1);
      } else if (str && str.length === 1 && !key.ctrl && !key.meta) {
        this.currentInput += str;
      }

      // Show filtered commands if user is typing a command
      if (this.currentInput.startsWith('/') || this.currentInput.startsWith('-')) {
        this.showLiveFilter(this.currentInput);
      } else if (this.filterDisplayActive) {
        this.clearLiveFilter();
      }
    });
  }

  // Show filtered commands below the input area
  showLiveFilter(partialCommand) {
    const matches = [];
    const commands = this.commandParser.getCommands();

    // Special case: if user just typed "/" show all commands
    if (partialCommand === '/') {
      for (const [name, config] of commands) {
        matches.push({ command: name, description: config.description, display: `${name} - ${config.description}` });
      }
    } else {
      // Find matching commands
      for (const [name, config] of commands) {
        if (name.startsWith(partialCommand)) {
          matches.push({ command: name, description: config.description, display: `${name} - ${config.description}` });
        }
        for (const alias of config.aliases) {
          if (alias.startsWith(partialCommand)) {
            matches.push({ command: alias, description: config.description, display: `${alias} (${name}) - ${config.description}` });
          }
        }
      }
    }

    // Only show if we have matches and not too many
    if (matches.length > 0 && matches.length <= 10) {
      this.clearLiveFilter(); // Clear previous display

      // Store filtered commands and reset selection
      this.filteredCommands = matches;
      this.selectedIndex = 0;

      // Save cursor position and move down
      process.stdout.write('\x1b[s'); // Save cursor position
      process.stdout.write('\n'); // Move to next line

      // Display matches with styling
      const header = partialCommand === '/'
        ? ANSI.paint('📝 All available commands:', 'cyan', this.display.noColor)
        : ANSI.paint('📝 Matching commands:', 'cyan', this.display.noColor);
      process.stdout.write(header + ' ' + ANSI.paint('(↑↓ to navigate, Enter to select, Esc to cancel)', 'gray', this.display.noColor) + '\n');

      this.renderFilteredCommands();

      // Restore cursor position and show cursor
      process.stdout.write('\x1b[u'); // Restore cursor position
      process.stdout.write('\x1b[?25h'); // Show cursor
      this.filterDisplayActive = true;
    } else if (this.filterDisplayActive) {
      this.clearLiveFilter();
    }
  }

  // Render the filtered commands list with highlight
  renderFilteredCommands() {
    this.filteredCommands.forEach((match, index) => {
      const isSelected = index === this.selectedIndex;
      const prefix = isSelected ? '▶ ' : '  ';
      const style = isSelected ? 'yellow' : 'gray';
      const styledMatch = ANSI.paint(`${prefix}${match.display}`, style, this.display.noColor);
      process.stdout.write(styledMatch + '\n');
    });
  }

  // Navigate through filtered commands
  navigateFilter(direction) {
    if (!this.filterDisplayActive || this.filteredCommands.length === 0) return;

    this.selectedIndex += direction;

    // Wrap around
    if (this.selectedIndex < 0) {
      this.selectedIndex = this.filteredCommands.length - 1;
    } else if (this.selectedIndex >= this.filteredCommands.length) {
      this.selectedIndex = 0;
    }

    // Re-render the list with new selection
    process.stdout.write('\x1b[s'); // Save cursor position
    process.stdout.write('\n'); // Move to content area

    // Skip the header line
    process.stdout.write('\x1b[B');

    // Clear and re-render the command list
    for (let i = 0; i < this.filteredCommands.length; i++) {
      process.stdout.write('\x1b[2K'); // Clear line
      if (i < this.filteredCommands.length - 1) {
        process.stdout.write('\x1b[B'); // Move to next line
      }
    }

    // Move back to start of command list
    for (let i = 0; i < this.filteredCommands.length - 1; i++) {
      process.stdout.write('\x1b[A');
    }

    // Re-render commands
    this.renderFilteredCommands();

    // Restore cursor position
    process.stdout.write('\x1b[u');
    process.stdout.write('\x1b[?25h'); // Show cursor
  }

  // Execute the selected command
  executeSelectedCommand() {
    if (!this.filterDisplayActive || this.filteredCommands.length === 0) return;

    const selectedCommand = this.filteredCommands[this.selectedIndex];

    // Clear the filter display first
    this.clearLiveFilter();

    // Reset current input state
    this.currentInput = '';

    // Clear the current readline input completely
    this.rl.line = '';
    this.rl.cursor = 0;

    // Refresh the display to show empty prompt
    process.stdout.write('\x1b[2K'); // Clear entire line
    process.stdout.write('\r'); // Move cursor to beginning of line
    process.stdout.write(this.display.createPrompt());

    // Parse and execute the command directly
    const { command, args, raw } = this.commandParser.parse(selectedCommand.command);

    // Execute immediately without going through readline
    setImmediate(async () => {
      try {
        await this.handleCommand(command, args, raw);
      } catch (error) {
        this.display.showError(error.message);
      }

      if (this.running) {
        this.rl.prompt();
      }
    });
  }

  // Clear the live filter display
  clearLiveFilter() {
    if (!this.filterDisplayActive) return;

    // Save cursor position
    process.stdout.write('\x1b[s');

    // Move down and clear the lines we wrote
    process.stdout.write('\n');
    for (let i = 0; i < 15; i++) { // Clear up to 15 lines (header + commands + buffer)
      process.stdout.write('\x1b[2K'); // Clear entire line
      process.stdout.write('\x1b[B'); // Move down one line
    }

    // Move back up to clear the lines
    for (let i = 0; i < 15; i++) {
      process.stdout.write('\x1b[A'); // Move up one line
    }

    // Restore cursor position and show cursor
    process.stdout.write('\x1b[u');
    process.stdout.write('\x1b[?25h'); // Show cursor

    this.filterDisplayActive = false;
    this.currentInput = '';
    this.filteredCommands = [];
    this.selectedIndex = 0;
  }

  // Kill all active agents
  killAllAgents() {
    // Access the global activeProcesses from index.js
    const activeProcesses = global.activeProcesses || new Set();

    if (activeProcesses.size === 0) {
      this.display.showInfo('No active agents to kill.');
      return;
    }

    const processCount = activeProcesses.size;
    this.display.showInfo(`🛑 Killing ${processCount} active agent${processCount > 1 ? 's' : ''}...`);

    // Kill all active child processes more aggressively
    for (const child of activeProcesses) {
      if (!child.killed) {
        try {
          // First try SIGTERM
          child.kill('SIGTERM');

          // Immediately follow up with SIGKILL for more reliable termination
          setTimeout(() => {
            if (!child.killed) {
              child.kill('SIGKILL');
            }
          }, 100); // Reduced timeout to 100ms for faster termination

        } catch (error) {
          // Process might already be dead, ignore errors
          console.log(`Failed to kill process: ${error.message}`);
        }
      }
    }

    // Clear the set immediately
    activeProcesses.clear();

    // Set global interruption flag
    global.orchestrationInterrupted = true;

    this.display.showSuccess('All agents terminated.');

    // Also try to exit any ongoing operations
    if (this.questionHandler) {
      this.display.showInfo('Interrupting ongoing orchestration...');
    }
  }

  // Dependency injection for question handler
  setQuestionHandler(handler) {
    this.questionHandler = handler;
  }
}