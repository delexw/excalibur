/**
 * BlessedInteractive - Full blessed-based interactive terminal UI
 *
 * Replaces interactive.js with a proper blessed TUI that includes:
 * - ASCII logo display
 * - Command input with autocomplete
 * - Multi-agent output in split panes during orchestration
 * - Config management UI
 * - History display
 * - Help panel
 *
 * This is a complete replacement for the custom readline-based interactive.js
 */

import blessed from "blessed";
import { SessionManager } from "./session-manager.js";
import { spawnAgentProcess } from "./agent-process.js";

// Common widget configurations (DRY principle)
const SCROLLBAR_CONFIG = {
  ch: "█",
  track: {
    ch: "░",
    bg: "black",
  },
  style: {
    fg: "cyan",
    bg: "black",
  },
};

const COMMON_SCROLLABLE_CONFIG = {
  tags: true,
  scrollable: true,
  keys: true,
  vi: true,
  focusable: true, // Make panels focusable for keyboard scrolling
  scrollbar: SCROLLBAR_CONFIG,
  wrap: true, // Enable word wrapping for long text
};

const COMMON_LOG_CONFIG = {
  ...COMMON_SCROLLABLE_CONFIG,
  alwaysScroll: false, // Don't force auto-scroll - let user control scrolling
  mouse: true, // Enable mouse for wheel events
  interactive: true, // Allow user interaction with the log
};

// Widget factory methods (Factory Pattern)
class WidgetFactory {
  static createScrollableLog(options) {
    return blessed.log({
      ...COMMON_LOG_CONFIG,
      ...options,
    });
  }

  static createBox(options) {
    return blessed.box({
      tags: true,
      ...options,
    });
  }

  static createInputElement(options) {
    return blessed.element({
      keys: true,
      vi: false,
      focusable: true,
      input: true,
      tags: true, // Enable markup for blinking cursor
      mouse: true, // Enable mouse to capture click for focus
      ...options,
    });
  }
}

export class BlessedInteractive {
  constructor(options = {}) {
    this.sessionManager = options.sessionManager || new SessionManager();
    this.questionHandler = options.questionHandler || null;
    this.logger = options.logger || null;
    this.processManager = options.processManager || null;

    if (options.agents) {
      this.sessionManager.setAgents(options.agents);
      if (this.logger) {
        this.logger.setAgents(options.agents);
      }
    }

    this.screen = null;
    this.inputBox = null;
    this.outputBox = null;
    this.logoBox = null;
    this.statusBar = null;
    this.orchestrationBox = null;

    this.agentPanes = new Map();
    this.commandHistory = [];
    this.historyIndex = -1;
    this.commandDropdown = null; // For command autocomplete dropdown

    // UI Mode state - use enum pattern for clarity
    this.UI_MODES = {
      INTERACTIVE: "interactive",
      ORCHESTRATION: "orchestration",
      AGENT_CHAT: "agent_chat",
    };
    this.currentMode = this.UI_MODES.INTERACTIVE;
    this.selectedAgents = []; // For agent chat mode
    this.isSubmitting = false; // Guard against double submission
    this.orchestrationActive = false; // Track if orchestration is actively running
  }

  /**
   * Initialize and show the interactive UI
   */
  async start() {
    this.createScreen();
    this.createLayout();
    this.setupKeyBindings();
    this.showWelcome();
    this.screen.render();
  }

  /**
   * Create the blessed screen
   */
  createScreen() {
    // Force xterm-256color for better compatibility with VSCode/Cursor terminals
    if (!process.env.TERM || process.env.TERM === "vscode") {
      process.env.TERM = "xterm-256color";
    }

    // Check if terminal supports Unicode/emoji (exclude dumb terminals)
    const useUnicode = process.env.TERM !== "dumb";

    this.screen = blessed.screen({
      smartCSR: true,
      title: "Excalibur - Interactive Mode",
      fullUnicode: useUnicode, // Enable full Unicode for emoji support
      dockBorders: true, // Prevent border rendering conflicts
      sendMouse: true, // Enable for mouse wheel events
      cursor: {
        artificial: true,
        shape: "line",
        blink: true,
        color: "white",
      },
      warnings: false,
    });

    // Disable Tab for focus switching - we handle it manually
    this.screen.ignoreLocked = ["tab"];
  }

  /**
   * Create the main layout (non-orchestration mode)
   */
  createLayout() {
    // Logo box at top
    this.logoBox = WidgetFactory.createBox({
      top: 0,
      left: 0,
      width: "100%",
      height: 10,
      content: this.getLogoText(),
      style: {
        fg: "cyan",
        bold: true,
      },
    });

    // Output/history box in middle
    this.outputBox = WidgetFactory.createScrollableLog({
      top: 10,
      left: 0,
      width: "100%",
      height: "100%-13",
      style: {
        fg: "white",
      },
    });

    // Create input box with event handlers
    this._createInputBox();

    // Status bar at very bottom
    this.statusBar = WidgetFactory.createBox({
      bottom: 0,
      left: 0,
      width: "100%",
      height: 2,
      content: this.getStatusText(),
      style: {
        fg: "gray",
      },
    });

    this.screen.append(this.logoBox);
    this.screen.append(this.outputBox);
    this.screen.append(this.inputBox);
    this.screen.append(this.statusBar);

    // Enable mouse events for scrolling
    this._enableMouseScrolling(this.outputBox);

    // Focus input by default - with keys: true, it will accept input
    this.inputBox.focus();
  }

  /**
   * Enable mouse scrolling on an element
   * @private
   */
  _enableMouseScrolling(element) {
    if (!element) return;

    // Mouse wheel up - scroll up (show earlier content)
    element.on("wheelup", () => {
      element.scroll(-3); // Positive value scrolls content up
      this.screen.render();
    });

    // Mouse wheel down - scroll down (show later content)
    element.on("wheeldown", () => {
      element.scroll(3); // Negative value scrolls content down
      this.screen.render();
    });
  }

  /**
   * Update input box cursor display
   * @private
   */
  _updateInputCursor() {
    if (!this.inputBox) return;
    const val = this.inputBox._value || "";
    const cursor = this.inputBox._cursorVisible ? "█" : " ";
    this.inputBox.setContent(val + cursor);
  }

  /**
   * Start cursor blinking animation
   * @private
   */
  _startCursorBlink() {
    // Clear existing interval
    if (this._cursorBlinkInterval) {
      clearInterval(this._cursorBlinkInterval);
    }

    // Blink cursor every 500ms
    this._cursorBlinkInterval = setInterval(() => {
      if (this.inputBox && this.currentMode === this.UI_MODES.INTERACTIVE) {
        this.inputBox._cursorVisible = !this.inputBox._cursorVisible;
        this._updateInputCursor();
        this.screen.render();
      }
    }, 500);
  }

  /**
   * Stop cursor blinking animation
   * @private
   */
  _stopCursorBlink() {
    if (this._cursorBlinkInterval) {
      clearInterval(this._cursorBlinkInterval);
      this._cursorBlinkInterval = null;
    }
  }

  /**
   * Create fresh input box with event handlers (DRY helper)
   * @private
   */
  _createInputBox() {
    // If inputBox already exists, remove it from screen and destroy
    if (this.inputBox) {
      this.inputBox.removeAllListeners();
      if (this.inputBox.parent) {
        this.screen.remove(this.inputBox);
      }
      this.inputBox.destroy();
    }

    // Use a plain element instead of textbox and handle input ourselves
    this.inputBox = WidgetFactory.createInputElement({
      bottom: 2,
      left: 0,
      width: "100%",
      height: 1,
      content: "",
      style: {
        fg: "white",
        bg: "blue",
      },
    });

    // Store the current value and add cursor support
    this.inputBox._value = "";
    this.inputBox._cursorVisible = true;
    this.inputBox.getValue = () => this.inputBox._value;
    this.inputBox.setValue = (val) => {
      this.inputBox._value = val;
      // Update content with cursor
      this._updateInputCursor();
    };

    // Initialize cursor
    this._updateInputCursor();

    // Start cursor blinking animation
    this._startCursorBlink();

    // Keep input box always focused - click anywhere should maintain focus
    this.screen.on("element click", () => {
      if (this.inputBox && !this.inputBox.detached) {
        this.inputBox.focus();
      }
    });

    // Handle character input manually
    this.inputBox.on("keypress", (ch, key) => {
      if (!key) return;

      if (key.name === "enter" || key.name === "return") {
        // Submit
        const value = this.inputBox.getValue();
        this.handleSubmit(value);
      } else if (key.name === "backspace") {
        // Delete last character
        const current = this.inputBox.getValue();
        this.inputBox.setValue(current.slice(0, -1));
        this.screen.render();
      } else if (ch && ch.length === 1 && !key.ctrl && !key.meta) {
        // Regular character
        const current = this.inputBox.getValue();
        this.inputBox.setValue(current + ch);
        this.screen.render();
      }
    });

    // Attach event handlers
    this.inputBox.key(["C-c"], () => {
      this.shutdown();
    });

    this.inputBox.key(["up"], () => {
      if (this.historyIndex > 0) {
        this.historyIndex--;
        this.inputBox.setValue(this.commandHistory[this.historyIndex] || "");
        this.screen.render();
      }
    });

    this.inputBox.key(["down"], () => {
      if (this.historyIndex < this.commandHistory.length - 1) {
        this.historyIndex++;
        this.inputBox.setValue(this.commandHistory[this.historyIndex] || "");
      } else {
        this.historyIndex = this.commandHistory.length;
        this.inputBox.setValue("");
      }
      this.screen.render();
    });
  }

  /**
   * Create orchestration layout with orchestration log at top and agent panels below
   * Always creates fresh panels
   */
  createOrchestrationLayout(agents) {
    // Get screen dimensions first
    const screenHeight = this.screen.height;
    const screenWidth = this.screen.width;
    // Reduce orchestration log to 15% to give more space to agents
    const orchestrationHeight = Math.max(5, Math.floor(screenHeight * 0.15));

    // Create fresh orchestration log panel
    this.orchestrationBox = WidgetFactory.createScrollableLog({
      top: 0,
      left: 0,
      width: "100%",
      height: orchestrationHeight,
      label: " Orchestration Log ",
      border: {
        type: "line",
      },
      style: {
        fg: "white",
        border: {
          fg: "cyan",
        },
      },
    });
    this.screen.append(this.orchestrationBox);

    // Enable mouse scrolling on orchestration log
    this._enableMouseScrolling(this.orchestrationBox);

    // Calculate grid layout for agent panels
    const numAgents = agents.length;
    // Use single column for better readability if 3 or fewer agents
    const cols = numAgents <= 3 ? 1 : 2;
    const rows = Math.ceil(numAgents / cols);

    // Reserve 3 lines at bottom for input box (1) + status bar (2)
    const reservedBottom = 3;
    const agentAreaHeight = screenHeight - orchestrationHeight - reservedBottom;
    const paneHeight = Math.floor(agentAreaHeight / rows);
    const paneWidth = Math.floor(screenWidth / cols);

    // Create fresh agent panels
    agents.forEach((agent, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);

      // Prevent border overlaps by adjusting dimensions
      const adjustedWidth = col === cols - 1 ? paneWidth : paneWidth - 1;
      const adjustedHeight = row === rows - 1 ? paneHeight : paneHeight - 1;

      const agentBox = WidgetFactory.createScrollableLog({
        top: orchestrationHeight + row * paneHeight,
        left: col * paneWidth,
        width: adjustedWidth,
        height: adjustedHeight,
        label: ` ${agent.displayName || agent.id} `,
        border: {
          type: "line",
        },
        style: {
          fg: "white",
          border: {
            fg: agent.color || "white",
          },
        },
      });

      this.agentPanes.set(agent.id, agentBox);
      this.screen.append(agentBox);

      // Enable mouse scrolling on agent panel
      this._enableMouseScrolling(agentBox);
    });
  }

  /**
   * Get ASCII logo text
   */
  getLogoText() {
    return `
{bold}{blue-fg}███████╗██╗  ██╗ ██████╗ █████╗ ██╗     ██╗██████╗ ██╗   ██╗██████╗{/blue-fg}{/bold}
{bold}{blue-fg}██╔════╝╚██╗██╔╝██╔════╝██╔══██╗██║     ██║██╔══██╗██║   ██║██╔══██╗{/blue-fg}{/bold}
{bold}{magenta-fg}█████╗   ╚███╔╝ ██║     ███████║██║     ██║██████╔╝██║   ██║██████╔╝{/magenta-fg}{/bold}
{bold}{magenta-fg}██╔══╝   ██╔██╗ ██║     ██╔══██║██║     ██║██╔══██╗██║   ██║██╔══██╗{/magenta-fg}{/bold}
{bold}{cyan-fg}███████╗██╔╝ ██╗╚██████╗██║  ██║███████╗██║██████╔╝╚██████╔╝██║  ██║{/cyan-fg}{/bold}
{bold}{cyan-fg}╚══════╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝{/cyan-fg}{/bold}

{yellow-fg}⚔️  EXCALIBUR CLI - Multi-Agent Debate Engine{/yellow-fg}`;
  }

  /**
   * Get status bar text
   */
  getStatusText() {
    const config = this.sessionManager.getConfig();
    const ownerInfo =
      config.owner && config.owner.length > 0
        ? ` | 👑 Owner: ${config.owner.join(", ")}`
        : "";
    const blessedStatus = config.blessed
      ? "🖥️ Interactive UI"
      : "📟 Terminal mode";
    return `📁 ${process.cwd()} | ⚖️ Consensus: ${config.consensus} | 🔄 Rounds: ${config.maxRounds} | ${blessedStatus}${ownerInfo} | /help for commands`;
  }

  /**
   * Show welcome message
   */
  showWelcome() {
    this.outputBox.log(
      "{cyan-fg}Welcome to Excalibur Interactive Mode!{/cyan-fg}",
    );
    this.outputBox.log("");
    this.outputBox.log("Type your question to start orchestration");
    this.outputBox.log("Type {bold}/help{/bold} to see available commands");
    this.outputBox.log("Type {bold}/config{/bold} to view/modify settings");
    this.outputBox.log("");
    this.outputBox.log(
      '{gray-fg}Tip: Press TAB for auto-completion, "/" for commands, ESC to kill agents{/gray-fg}',
    );
    this.outputBox.log("");
    this.updatePrompt();
  }

  /**
   * Update input prompt
   */
  updatePrompt() {
    this.inputBox.setValue("");
    this.screen.render();
  }

  /**
   * Setup live command filtering for inputBox
   * @private
   */
  _setupCommandFilter() {
    // Clear any existing interval
    if (this.filterInterval) {
      clearInterval(this.filterInterval);
    }

    // Live command filtering as user types
    let previousValue = "";
    this.filterInterval = setInterval(() => {
      if (this.screen.focused === this.inputBox) {
        const currentValue = this.inputBox.getValue();
        if (currentValue !== previousValue) {
          previousValue = currentValue;
          this.showLiveCommandFilter(currentValue);
        }
      }
    }, 100); // Check every 100ms
  }

  /**
   * Handle terminal resize events
   */
  handleResize() {
    if (this.currentMode === this.UI_MODES.ORCHESTRATION) {
      // In orchestration mode, adjust panel sizes
      const agents = this.sessionManager.getAgents();
      this.resizeOrchestrationLayout(agents);
    } else if (this.currentMode === this.UI_MODES.AGENT_CHAT) {
      // In agent chat mode, adjust selected agent panels
      this.resizeOrchestrationLayout(this.selectedAgents);
    }
    // Interactive mode doesn't need special handling - blessed handles it
    this.screen.render();
  }

  /**
   * Resize orchestration layout panels to fit new terminal dimensions
   */
  resizeOrchestrationLayout(agents) {
    if (!agents || agents.length === 0) return;

    const screenHeight = this.screen.height;
    const screenWidth = this.screen.width;
    const orchestrationHeight = Math.max(5, Math.floor(screenHeight * 0.15));

    // Resize orchestration box
    if (this.orchestrationBox) {
      this.orchestrationBox.height = orchestrationHeight;
      this.orchestrationBox.width = "100%";
    }

    // Recalculate grid layout
    const numAgents = agents.length;
    const cols = numAgents <= 3 ? 1 : 2;
    const rows = Math.ceil(numAgents / cols);

    const reservedBottom = 3;
    const agentAreaHeight = screenHeight - orchestrationHeight - reservedBottom;
    const paneHeight = Math.floor(agentAreaHeight / rows);
    const paneWidth = Math.floor(screenWidth / cols);

    // Resize each agent panel
    agents.forEach((agent, idx) => {
      const pane = this.agentPanes.get(agent.id);
      if (!pane) return;

      const col = idx % cols;
      const row = Math.floor(idx / cols);

      const adjustedWidth = col === cols - 1 ? paneWidth : paneWidth - 1;
      const adjustedHeight = row === rows - 1 ? paneHeight : paneHeight - 1;

      pane.top = orchestrationHeight + row * paneHeight;
      pane.left = col * paneWidth;
      pane.width = adjustedWidth;
      pane.height = adjustedHeight;
    });
  }

  /**
   * Setup keyboard bindings
   */
  setupKeyBindings() {
    // Handle terminal resize
    this.screen.on("resize", () => {
      this.handleResize();
    });

    // Ctrl+C to exit
    this.screen.key(["C-c"], () => {
      this.shutdown();
    });

    // Ctrl+L to clear output
    this.screen.key(["C-l"], () => {
      this.outputBox.setContent("");
      this.showWelcome();
      this.screen.render();
    });

    // ESC to kill all running agents and refocus input
    this.screen.key(["escape"], () => {
      this.killAllAgents();
      // Refocus input box after killing agents
      setTimeout(() => {
        this.inputBox.focus();
        this.screen.render();
      }, 100);
    });

    // NOTE: InputBox event handlers (C-c, submit, up, down) are set up in _createInputBox()
    // Don't add them here to avoid duplicates when inputBox is recreated

    // Setup command filter for inputBox
    this._setupCommandFilter();

    // Tab for autocomplete at screen level (to override default behavior)
    this.screen.key(["tab"], () => {
      const input = this.inputBox.getValue();

      // If empty or just "/", insert "/"
      if (!input || input === "") {
        this.inputBox.setValue("/");
        this.screen.render();
        return;
      }

      if (input.startsWith("/")) {
        const commands = [
          "/help",
          "/question",
          "/chat",
          "/config",
          "/agents",
          "/history",
          "/clear",
          "/exit",
        ];
        const matches = commands.filter((cmd) => cmd.startsWith(input));

        if (matches.length === 1) {
          // Single match - autocomplete it
          this.inputBox.setValue(matches[0] + " ");
          this.screen.render();
        } else if (matches.length > 1) {
          // Multiple matches - show them
          this.outputBox.log(`{cyan-fg}💡 Matching commands:{/cyan-fg}`);
          matches.forEach((m) => {
            this.outputBox.log(`  {bold}${m}{/bold}`);
          });
          this.outputBox.log("");
          this.screen.render();
        }
      }
    });
  }

  /**
   * Handle input submission (Enter key or submit event)
   */
  async handleSubmit(value) {
    // Guard against double submission
    if (this.isSubmitting) {
      return;
    }
    this.isSubmitting = true;

    try {
      const input = (value || "").trim();

      // Always hide dropdown on submit
      this.hideCommandDropdown();

      if (!input) {
        this.updatePrompt();
        return;
      }

      // Special case: if input is just "/", show all commands
      if (input === "/") {
        this.outputBox.log(
          `{bold}{green-fg}Excalibur>{/green-fg}{/bold} ${input}`,
        );
        this.outputBox.log("");
        this.showHelp();
        this.updatePrompt();
        this.inputBox.focus();
        return;
      }

      // If input starts with "/" but is not a valid command, show suggestions
      if (
        input.startsWith("/") &&
        !this.isValidCommand(input.split(/\s+/)[0])
      ) {
        const partialCommand = input.split(/\s+/)[0];
        this.outputBox.log(
          `{bold}{green-fg}Excalibur>{/green-fg}{/bold} ${input}`,
        );
        this.outputBox.log("");
        this.showCommandSuggestions(partialCommand);
        this.updatePrompt();
        this.inputBox.focus();
        return;
      }

      // Add to history
      this.commandHistory.push(input);
      this.historyIndex = this.commandHistory.length;

      // Echo command
      this.outputBox.log(
        `{bold}{green-fg}Excalibur>{/green-fg}{/bold} ${input}`,
      );
      this.outputBox.log("");

      // Handle command
      await this.handleInput(input);

      this.updatePrompt();
      this.inputBox.focus();
    } finally {
      this.isSubmitting = false;
    }
  }

  /**
   * Handle user input
   */
  async handleInput(input) {
    // Parse command
    if (input.startsWith("/")) {
      await this.handleCommand(input);
    } else {
      // It's a question for orchestration
      await this.handleQuestion(input);
    }
  }

  /**
   * Handle slash commands
   */
  async handleCommand(input) {
    const parts = input.split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);

    switch (command) {
      case "/help":
        this.showHelp();
        break;

      case "/question":
        if (args.length === 0) {
          this.outputBox.log(
            "{red-fg}Usage: /question <your question>{/red-fg}",
          );
        } else {
          await this.handleQuestion(args.join(" "));
        }
        break;

      case "/config":
        if (args.length === 0) {
          this.showConfig();
        } else if (args.length === 2) {
          this.updateConfig(args[0], args[1]);
        } else {
          this.outputBox.log("{red-fg}Usage: /config [key value]{/red-fg}");
        }
        break;

      case "/agents":
        this.showAgents();
        break;

      case "/chat":
        if (args.length === 0) {
          this.outputBox.log(
            '{red-fg}Usage: /chat <agent1> [agent2] ... or "all"{/red-fg}',
          );
          this.outputBox.log(
            "Example: {bold}/chat claude{/bold} - Chat with Claude only",
          );
          this.outputBox.log(
            "Example: {bold}/chat claude gemini{/bold} - Chat with Claude and Gemini",
          );
          this.outputBox.log(
            "Example: {bold}/chat all{/bold} - Use all agents (orchestration mode)",
          );
        } else {
          await this.selectAgentsForChat(args);
        }
        break;

      case "/history":
        this.showHistory();
        break;

      case "/clear":
        this.outputBox.setContent("");
        this.showWelcome();
        break;

      case "/exit":
        this.shutdown();
        break;

      default:
        this.outputBox.log(`{red-fg}Unknown command: ${command}{/red-fg}`);
        this.outputBox.log("Type {bold}/help{/bold} for available commands");
    }

    this.outputBox.log("");
  }

  /**
   * Check if a command is valid
   */
  isValidCommand(cmd) {
    const validCommands = [
      "/help",
      "/question",
      "/chat",
      "/config",
      "/agents",
      "/history",
      "/clear",
      "/exit",
    ];
    return validCommands.includes(cmd);
  }

  /**
   * Show command suggestions for partial command input
   */
  showCommandSuggestions(partialCommand) {
    const commands = [
      { cmd: "/help", desc: "Show this help" },
      { cmd: "/question", desc: "Ask a question to agents" },
      { cmd: "/chat", desc: "Chat with specific agents" },
      { cmd: "/config", desc: "Show/modify configuration" },
      { cmd: "/agents", desc: "List available agents" },
      { cmd: "/history", desc: "Show command history" },
      { cmd: "/clear", desc: "Clear screen" },
      { cmd: "/exit", desc: "Exit interactive mode" },
    ];

    const matches = commands.filter((c) => c.cmd.startsWith(partialCommand));

    if (matches.length > 0) {
      this.outputBox.log("{cyan-fg}💡 Did you mean:{/cyan-fg}");
      matches.forEach((m) => {
        this.outputBox.log(`  {bold}${m.cmd}{/bold} - ${m.desc}`);
      });
    } else {
      this.outputBox.log(`{red-fg}Unknown command: ${partialCommand}{/red-fg}`);
      this.outputBox.log("Type {bold}/help{/bold} for all available commands");
    }
    this.outputBox.log("");
  }

  /**
   * Show live command filter as user types
   */
  showLiveCommandFilter(input) {
    // Don't show if input doesn't start with "/"
    if (!input || !input.startsWith("/")) {
      this.hideCommandDropdown();
      return;
    }

    const commands = [
      { cmd: "/help", desc: "Show this help" },
      { cmd: "/question", desc: "Ask a question to agents" },
      { cmd: "/chat", desc: "Chat with specific agents" },
      { cmd: "/config", desc: "Show/modify configuration" },
      { cmd: "/agents", desc: "List available agents" },
      { cmd: "/history", desc: "Show command history" },
      { cmd: "/clear", desc: "Clear screen" },
      { cmd: "/exit", desc: "Exit interactive mode" },
    ];

    const partialCommand = input.split(/\s+/)[0];
    const matches = commands.filter((c) => c.cmd.startsWith(partialCommand));

    // Show dropdown if we have matches and input is partial (not exact match)
    if (matches.length > 0 && !matches.some((m) => m.cmd === partialCommand)) {
      this.showCommandDropdown(matches);
    } else {
      this.hideCommandDropdown();
    }
  }

  /**
   * Show command dropdown list
   */
  showCommandDropdown(matches) {
    // Remove existing dropdown if any
    this.hideCommandDropdown();

    // Create dropdown box
    const height = Math.min(matches.length + 2, 10); // Max 10 items + border
    this.commandDropdown = WidgetFactory.createBox({
      top: this.inputBox.top - height,
      left: 0,
      width: "50%",
      height: height,
      border: {
        type: "line",
      },
      style: {
        fg: "white",
        border: {
          fg: "cyan",
        },
      },
      label: " 💡 Commands ",
    });

    // Add command items
    let content = "";
    matches.forEach((match, idx) => {
      content += `{cyan-fg}${match.cmd}{/cyan-fg} - {gray-fg}${match.desc}{/gray-fg}\n`;
    });
    this.commandDropdown.setContent(content);

    this.screen.append(this.commandDropdown);
    this.screen.render();
  }

  /**
   * Hide command dropdown
   */
  hideCommandDropdown() {
    if (this.commandDropdown) {
      this.screen.remove(this.commandDropdown);
      this.commandDropdown.destroy();
      this.commandDropdown = null;
      this.screen.render();
    }
  }

  /**
   * Show help
   */
  showHelp() {
    this.outputBox.log("{bold}{cyan-fg}Available Commands:{/cyan-fg}{/bold}");
    this.outputBox.log("");
    this.outputBox.log(
      "  {bold}/help{/bold}                    - Show this help",
    );
    this.outputBox.log(
      "  {bold}/question <text>{/bold}         - Ask a question to agents",
    );
    this.outputBox.log(
      "  {bold}/chat <agents>{/bold}           - Chat with specific agents (e.g., /chat claude gemini)",
    );
    this.outputBox.log(
      "  {bold}/chat all{/bold}                - Return to orchestration mode (all agents)",
    );
    this.outputBox.log(
      "  {bold}/config{/bold}                  - Show configuration",
    );
    this.outputBox.log(
      "  {bold}/config <key> <value>{/bold}   - Set configuration",
    );
    this.outputBox.log(
      "  {bold}/agents{/bold}                  - List available agents",
    );
    this.outputBox.log(
      "  {bold}/history{/bold}                 - Show command history",
    );
    this.outputBox.log(
      "  {bold}/clear{/bold}                   - Clear screen",
    );
    this.outputBox.log(
      "  {bold}/exit{/bold}                    - Exit interactive mode",
    );
    this.outputBox.log("");
    this.outputBox.log("{bold}Config Keys:{/bold}");
    this.outputBox.log(
      "  consensus, maxRounds, blessed, preset, unanimousPct,",
    );
    this.outputBox.log(
      "  superMajorityPct, majorityPct, allowBlockers, rubberPenalty,",
    );
    this.outputBox.log("  owner, ownerMin, ownerMode");
  }

  /**
   * Show configuration
   */
  showConfig() {
    const config = this.sessionManager.getConfig();
    this.outputBox.log(
      "{bold}{cyan-fg}Current Configuration:{/cyan-fg}{/bold}",
    );
    this.outputBox.log("");
    for (const [key, value] of Object.entries(config)) {
      const valueStr = Array.isArray(value) ? value.join(",") : String(value);
      this.outputBox.log(`  {bold}${key}:{/bold} ${valueStr}`);
    }
    this.statusBar.setContent(this.getStatusText());
  }

  /**
   * Update configuration
   */
  updateConfig(key, value) {
    // Parse value
    let parsedValue = value;
    if (value === "true") parsedValue = true;
    else if (value === "false") parsedValue = false;
    else if (!isNaN(value)) parsedValue = Number(value);
    else if (value.includes(",")) parsedValue = value.split(",");

    if (this.sessionManager.updateConfig(key, parsedValue)) {
      this.outputBox.log(`{green-fg}✓ Set ${key} = ${value}{/green-fg}`);
      this.statusBar.setContent(this.getStatusText());
    } else {
      this.outputBox.log(`{red-fg}✗ Invalid config key: ${key}{/red-fg}`);
    }
  }

  /**
   * Show agents
   */
  showAgents() {
    const agents = this.sessionManager.getAgents();
    this.outputBox.log("{bold}{cyan-fg}Available Agents:{/cyan-fg}{/bold}");
    this.outputBox.log("");
    for (const agent of agents) {
      this.outputBox.log(
        `  ${agent.avatar || "🤖"} {bold}${agent.displayName || agent.id}{/bold}`,
      );
      this.outputBox.log(`     Command: ${agent.cmd}`);
    }
  }

  /**
   * Show history
   */
  showHistory() {
    const history = this.sessionManager.getHistory();
    this.outputBox.log("{bold}{cyan-fg}Command History:{/cyan-fg}{/bold}");
    this.outputBox.log("");
    if (history.length === 0) {
      this.outputBox.log("  {gray-fg}No history yet{/gray-fg}");
    } else {
      for (const entry of history.slice(-10)) {
        const status =
          entry.result === "success"
            ? "{green-fg}✓{/green-fg}"
            : "{red-fg}✗{/red-fg}";
        this.outputBox.log(`  ${status} ${entry.command}`);
      }
    }
  }

  /**
   * Select agents for chat mode
   */
  async selectAgentsForChat(agentNames) {
    const allAgents = this.sessionManager.getAgents();

    if (agentNames.length === 1 && agentNames[0].toLowerCase() === "all") {
      // Use all agents - full orchestration mode
      this.selectedAgents = [];
      this.outputBox.log(
        "{green-fg}✓ Using all agents (orchestration mode){/green-fg}",
      );
      this.outputBox.log("");
      return;
    }

    // Find matching agents
    const selected = [];
    const notFound = [];

    for (const name of agentNames) {
      const agent = allAgents.find(
        (a) =>
          a.id.toLowerCase() === name.toLowerCase() ||
          a.displayName.toLowerCase().includes(name.toLowerCase()),
      );
      if (agent) {
        selected.push(agent);
      } else {
        notFound.push(name);
      }
    }

    if (notFound.length > 0) {
      this.outputBox.log(
        `{yellow-fg}⚠️  Agent(s) not found: ${notFound.join(", ")}{/yellow-fg}`,
      );
    }

    if (selected.length === 0) {
      this.outputBox.log("{red-fg}✗ No valid agents selected{/red-fg}");
      this.outputBox.log("");
      return;
    }

    this.selectedAgents = selected;

    const agentList = selected
      .map((a) => `${a.avatar || "🤖"} ${a.displayName || a.id}`)
      .join(", ");
    this.outputBox.log(
      `{green-fg}✓ Chat mode activated with: ${agentList}{/green-fg}`,
    );
    this.outputBox.log(
      "{gray-fg}Your messages will be sent directly to these agents without orchestration.{/gray-fg}",
    );
    this.outputBox.log(
      "{gray-fg}Use {bold}/chat all{/bold} to return to orchestration mode.{/gray-fg}",
    );
    this.outputBox.log("");
  }

  /**
   * Spawn agent process and stream output to panel (SOLID: Single Responsibility)
   * @private
   * @param {Object} agent - Agent configuration
   * @param {string} prompt - Prompt to send to agent
   * @returns {Promise<string>} - Full output from agent
   */
  async _spawnAgentProcess(agent, prompt) {
    let buffer = "";

    // Use shared spawn utility with streaming callback
    const result = await spawnAgentProcess(agent, prompt, {
      onStdout: (text) => {
        buffer += text;

        // Display complete lines only
        const lines = buffer.split("\n");
        if (lines.length > 1) {
          // Last item is incomplete line, keep it
          buffer = lines.pop();

          // Display complete lines
          for (const line of lines) {
            if (line.trim() && this.agentPanes.has(agent.id)) {
              this.appendToAgentPanel(agent.id, line);
            }
          }
        }
      },
      processManager: this.processManager,
    });

    // Display any remaining buffer
    if (buffer.trim() && this.agentPanes.has(agent.id)) {
      this.appendToAgentPanel(agent.id, buffer);
    }

    return result.output;
  }

  /**
   * Send message directly to selected agents (agent chat mode)
   */
  async sendToAgentsDirectly(question) {
    const config = this.sessionManager.getConfig();

    // Create agent panels if blessed UI is enabled
    if (config.blessed && this.currentMode === this.UI_MODES.INTERACTIVE) {
      await this.switchToAgentChatMode();
    }

    // Send to each selected agent
    for (const agent of this.selectedAgents) {
      try {
        this.outputBox.log(
          `{cyan-fg}${agent.avatar || "🤖"} ${agent.displayName || agent.id}: Thinking...{/cyan-fg}`,
        );
        if (this.agentPanes.has(agent.id)) {
          this.appendToAgentPanel(
            agent.id,
            `{cyan-fg}User: ${question}{/cyan-fg}`,
          );
          this.appendToAgentPanel(agent.id, "");
        }

        // Use shared spawn method (DRY principle)
        await this._spawnAgentProcess(agent, question);

        this.outputBox.log(
          `{green-fg}${agent.avatar || "🤖"} ${agent.displayName || agent.id}: Done{/green-fg}`,
        );
      } catch (error) {
        this.outputBox.log(
          `{red-fg}✗ Error with ${agent.displayName || agent.id}: ${error.message}{/red-fg}`,
        );
        this.outputBox.log("");
        if (this.agentPanes.has(agent.id)) {
          this.appendToAgentPanel(
            agent.id,
            `{red-fg}Error: ${error.message}{/red-fg}`,
          );
          this.appendToAgentPanel(agent.id, "");
        }
      }
    }

    // Switch back to interactive mode if blessed UI was used
    if (config.blessed && this.currentMode === this.UI_MODES.AGENT_CHAT) {
      await this.switchToInteractiveMode();
    }

    this.sessionManager.addToHistory(question, true);
  }

  /**
   * Handle question (start orchestration or agent chat)
   */
  async handleQuestion(question) {
    if (!this.questionHandler) {
      this.outputBox.log(
        "{red-fg}Error: No question handler configured{/red-fg}",
      );
      return;
    }

    let config;
    try {
      // Check if in agent chat mode
      if (this.selectedAgents.length > 0) {
        this.outputBox.log("{cyan-fg}Sending to selected agents...{/cyan-fg}");
        this.outputBox.log("");
        await this.sendToAgentsDirectly(question);
        return;
      }

      // Normal orchestration mode
      this.outputBox.log("{cyan-fg}Starting orchestration...{/cyan-fg}");
      this.outputBox.log("");

      // Get config and check if blessed UI should be used
      config = this.sessionManager.getConfig();

      if (config.blessed) {
        // Switch to orchestration mode (multi-pane)
        await this.switchToOrchestrationMode();
        // Mark orchestration as active for auto-scrolling
        this.orchestrationActive = true;
      }

      // Run orchestration
      const result = await this.questionHandler(question, config);

      // Mark orchestration as inactive to allow user scrolling
      this.orchestrationActive = false;

      // Display final answer FIRST (while blessed UI is still active)
      if (result.success && result.finalAnswer) {
        // Keep blessed UI active to catch any final logs
        // Don't switch modes yet
      } else if (!result.success) {
        this.outputBox.log(
          `{red-fg}✗ Orchestration failed: ${result.error}{/red-fg}`,
        );
        this.sessionManager.addToHistory(question, false);
      }

      // NOW switch back to interactive mode and display result
      if (config.blessed) {
        // Switch back to interactive mode (destroys panels and recreates initial UI)
        // This is now fully synchronous - no waiting needed
        await this.switchToInteractiveMode();
      }

      // Display final answer in the fresh output box
      if (result.success && result.finalAnswer) {
        this.outputBox.log("");
        this.outputBox.log("{cyan-fg}" + "═".repeat(60) + "{/cyan-fg}");
        this.outputBox.log(
          "{bold}{green-fg}===== FINAL ANSWER ====={/green-fg}{/bold}",
        );
        this.outputBox.log("{cyan-fg}" + "═".repeat(60) + "{/cyan-fg}");
        this.outputBox.log("");
        // Display final answer (blessed tags already in the text)
        const lines = result.finalAnswer.split("\n");
        for (const line of lines) {
          this.outputBox.log(line);
        }
        this.outputBox.log("");
        this.outputBox.log("{cyan-fg}" + "═".repeat(60) + "{/cyan-fg}");
        this.outputBox.log("");
        this.sessionManager.addToHistory(question, true);
      }
    } catch (error) {
      // Ensure we switch back to interactive mode on error
      if (config && config.blessed) {
        try {
          await this.switchToInteractiveMode();
        } catch (switchError) {
          console.error(
            "Error switching back to interactive mode:",
            switchError,
          );
        }
      }

      // If outputBox is null (during mode switch), log to console instead
      if (this.outputBox) {
        this.outputBox.log(`{red-fg}Error: ${error.message}{/red-fg}`);
      } else {
        console.error(`Error: ${error.message}`);
      }
      this.sessionManager.addToHistory(question, false);
    }

    // Only log if outputBox exists
    if (this.outputBox) {
      this.outputBox.log("");
    }
  }

  /**
   * Hide orchestration panels (DO NOT destroy them)
   * @private
   *
   * IMPORTANT: Blessed's log() uses setImmediate() to schedule scroll operations.
   * Destroying panels causes race conditions where callbacks try to access parent.itop
   * after parent is null. The ONLY safe approach is to HIDE panels, not destroy them.
   * Panels are only destroyed when the screen itself is destroyed on app exit.
   */
  _hideOrchestrationPanels() {
    // Hide orchestration box (don't destroy)
    if (this.orchestrationBox) {
      try {
        this.orchestrationBox.hide();
      } catch (err) {
        // Ignore errors
      }
    }

    // Hide agent panes (don't destroy)
    for (const [agentId, pane] of this.agentPanes.entries()) {
      try {
        pane.hide();
      } catch (err) {
        // Ignore errors
      }
    }
  }

  /**
   * Destroy orchestration panels after orchestration completes
   * @private
   */
  async _destroyOrchestrationPanels() {
    // Wait for any pending setImmediate callbacks from blessed.log widgets
    if (this.orchestrationBox || this.agentPanes.size > 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    // Destroy orchestration box
    if (this.orchestrationBox) {
      try {
        if (this.orchestrationBox.parent) {
          this.orchestrationBox.detach();
        }
        this.orchestrationBox.destroy();
      } catch (err) {
        // Ignore errors
      }
      this.orchestrationBox = null;
    }

    // Destroy agent panes
    for (const [agentId, pane] of this.agentPanes.entries()) {
      try {
        if (pane.parent) {
          pane.detach();
        }
        pane.destroy();
      } catch (err) {
        // Ignore errors
      }
    }
    this.agentPanes.clear();
  }

  /**
   * Switch to agent chat mode (hide interactive UI, show only selected agent panes)
   */
  async switchToAgentChatMode() {
    if (this.currentMode === this.UI_MODES.AGENT_CHAT) return;

    // Clear blessed UI from logger before mode switch
    if (this.logger) {
      this.logger.setBlessedUI(null);
    }

    // Hide any existing orchestration panels
    this._hideOrchestrationPanels();

    // Hide interactive UI elements
    this.logoBox.hide();
    this.outputBox.hide();
    this.inputBox.hide();
    this.statusBar.hide();

    // Update state
    this.currentMode = this.UI_MODES.AGENT_CHAT;

    // Create layout for selected agents only (no orchestration log)
    this.createOrchestrationLayout(this.selectedAgents);

    this.screen.render();
  }

  /**
   * Switch to orchestration mode (hide interactive UI, show agent panes)
   */
  async switchToOrchestrationMode() {
    if (this.currentMode === this.UI_MODES.ORCHESTRATION) return;

    // Stop cursor blinking
    this._stopCursorBlink();

    // Destroy any existing orchestration panels completely
    this._destroyOrchestrationPanels();

    // Hide interactive UI elements
    this.logoBox.hide();
    this.outputBox.hide();

    // Detach inputBox completely from screen to stop input handling
    if (this.inputBox.parent) {
      this.inputBox.detach();
    }

    // Update state FIRST so runOrchestration() can detect it
    this.currentMode = this.UI_MODES.ORCHESTRATION;

    // Get agents from session manager
    const agents = this.sessionManager.getAgents();

    // Create fresh orchestration layout
    this.createOrchestrationLayout(agents);

    // Set blessed UI on logger so orchestration output goes to panels
    if (this.logger) {
      this.logger.setBlessedUI(this);
    }

    // Force screen to recognize new widgets and re-enable input
    this.screen.realloc();
    this.screen.render();
  }

  /**
   * Switch back to interactive mode (hide agent panes, show interactive UI)
   * Completely recreates the initial panel as if launching "excalibur" fresh
   */
  async switchToInteractiveMode() {
    if (this.currentMode === this.UI_MODES.INTERACTIVE) return;

    // Reset submission guard and orchestration flag
    this.isSubmitting = false;
    this.orchestrationActive = false;

    // Clear blessed UI from logger before destroying panels
    if (this.logger) {
      this.logger.setBlessedUI(null);
    }

    // Destroy all orchestration panels completely
    this._destroyOrchestrationPanels();

    // Wait for outputBox's pending setImmediate callbacks to complete
    // This is necessary because blessed.log uses setImmediate internally
    await new Promise((resolve) => setImmediate(resolve));

    // Update state
    this.currentMode = this.UI_MODES.INTERACTIVE;

    // Show interactive UI elements first (the existing ones)
    this.logoBox.show();
    this.outputBox.show();
    this.statusBar.show();

    // Completely destroy and recreate the inputBox
    // This clears any lingering blessed internal state
    if (this.inputBox) {
      if (this.inputBox.parent) {
        this.screen.remove(this.inputBox);
      }
      this.inputBox.destroy();
    }

    // Recreate from scratch
    this._createInputBox();
    this.screen.append(this.inputBox);

    // Clear outputBox content for fresh start
    this.outputBox.setContent("");

    // Show welcome message
    this.showWelcome();

    // Force full screen refresh
    this.screen.realloc();
    this.screen.render();

    // Focus after all operations complete
    setImmediate(() => {
      this.inputBox.focus();
      this.screen.render();
    });
  }

  /**
   * Append text to orchestration log panel
   */
  appendToOrchestrationLog(text) {
    if (!this.orchestrationBox || !text) return;

    // Check if orchestrationBox still has valid parent (not detached)
    if (!this.orchestrationBox.parent || this.orchestrationBox.detached) return;

    try {
      // Use built-in log() method
      this.orchestrationBox.log(text);
      // Only auto-scroll during active orchestration to avoid fighting user input
      if (this.orchestrationActive) {
        this.orchestrationBox.setScrollPerc(100);
      }
      this.screen.render();
    } catch (err) {
      // Silently ignore errors from detached panels
    }
  }

  /**
   * Set header message (alias for appendToOrchestrationLog for compatibility)
   */
  setHeaderMessage(text) {
    this.appendToOrchestrationLog(text);
  }

  /**
   * Append text to specific agent panel (alias for appendToAgentPanel)
   */
  appendToAgent(agentId, text) {
    this.appendToAgentPanel(agentId, text);
  }

  /**
   * Append text to specific agent panel
   */
  appendToAgentPanel(agentId, text) {
    const pane = this.agentPanes.get(agentId);
    if (!pane || !text) return;

    // Check if pane still has valid parent (not detached)
    if (!pane.parent || pane.detached) return;

    try {
      // Use built-in log() method
      pane.log(text);
      // Add extra line break for better readability
      pane.log("");
      // Only auto-scroll during active orchestration to avoid fighting user input
      if (this.orchestrationActive) {
        pane.setScrollPerc(100);
      }
      this.screen.render();
    } catch (err) {
      // Silently ignore errors from detached panes
    }
  }

  /**
   * Set agent panel status (updates border color or label)
   */
  setAgentStatus(agentId, status) {
    const pane = this.agentPanes.get(agentId);
    if (!pane) return;

    // Check if pane still has valid parent (not detached)
    if (!pane.parent || pane.detached) return;

    // Clear any existing animation for this agent
    this._clearAgentAnimation(agentId);

    const agent = this.sessionManager.getAgents().find((a) => a.id === agentId);
    const displayName = agent?.displayName || agentId;

    let statusSymbol = "";
    let borderColor = agent?.color || "white";

    switch (status) {
      case "running":
        statusSymbol = "[...]";
        borderColor = "yellow";
        // Start animation
        this._startAgentAnimation(agentId, pane, displayName, agent?.color || "white");
        break;
      case "completed":
        statusSymbol = "[✓]";
        borderColor = "green";
        break;
      case "failed":
        statusSymbol = "[✗]";
        borderColor = "red";
        break;
    }

    try {
      pane.setLabel(` ${displayName} ${statusSymbol} `);
      pane.style.border.fg = borderColor;
      this.screen.render();
    } catch (err) {
      // Silently ignore errors from detached panes
    }
  }

  /**
   * Start animation for running agent
   */
  _startAgentAnimation(agentId, pane, displayName, baseColor) {
    const spinChars = ['|', '/', '-', '\\'];
    let spinIdx = 0;

    this._agentAnimations = this._agentAnimations || new Map();

    const animationInterval = setInterval(() => {
      try {
        if (!pane.parent || pane.detached) {
          this._clearAgentAnimation(agentId);
          return;
        }

        // Spin the status symbol
        spinIdx = (spinIdx + 1) % spinChars.length;
        pane.setLabel(` ${displayName} [${spinChars[spinIdx]}] `);

        this.screen.render();
      } catch (err) {
        this._clearAgentAnimation(agentId);
      }
    }, 150);

    this._agentAnimations.set(agentId, animationInterval);
  }

  /**
   * Clear animation for agent
   */
  _clearAgentAnimation(agentId) {
    if (this._agentAnimations && this._agentAnimations.has(agentId)) {
      clearInterval(this._agentAnimations.get(agentId));
      this._agentAnimations.delete(agentId);
    }
  }

  /**
   * Kill all active agents
   */
  killAllAgents() {
    // Use injected processManager
    const processManager = this.processManager;

    if (!processManager || processManager.size === 0) {
      this.outputBox.log("{yellow-fg}No active agents to kill.{/yellow-fg}");
      this.outputBox.log("");
      return;
    }

    const processCount = processManager.size;
    this.outputBox.log(
      `{red-fg}🛑 Killing ${processCount} active agent${processCount > 1 ? "s" : ""}...{/red-fg}`,
    );

    // Kill all active child processes more aggressively
    for (const child of processManager) {
      if (!child.killed) {
        try {
          // First try SIGTERM
          child.kill("SIGTERM");

          // Immediately follow up with SIGKILL for more reliable termination
          setTimeout(() => {
            if (!child.killed) {
              child.kill("SIGKILL");
            }
          }, 100); // Reduced timeout to 100ms for faster termination
        } catch (error) {
          // Process might already be dead, ignore errors
          this.outputBox.log(
            `{red-fg}Failed to kill process: ${error.message}{/red-fg}`,
          );
        }
      }
    }

    // Clear the set
    processManager.clear();

    // Set interruption flag
    global.orchestrationInterrupted = true;

    this.outputBox.log("{green-fg}✓ All agents killed{/green-fg}");
    this.outputBox.log("");
  }

  /**
   * Shutdown and cleanup
   */
  shutdown() {
    // Stop cursor blinking
    this._stopCursorBlink();

    // Clear the filter interval
    if (this.filterInterval) {
      clearInterval(this.filterInterval);
      this.filterInterval = null;
    }

    // Clear all agent animations
    if (this._agentAnimations) {
      for (const interval of this._agentAnimations.values()) {
        clearInterval(interval);
      }
      this._agentAnimations.clear();
    }

    // Kill all active processes using injected processManager
    if (this.processManager) {
      this.processManager.killAll('SIGTERM');
    }

    // Destroy screen (which destroys all children including panels)
    if (this.screen) {
      this.screen.destroy();
    }
    console.log('\n👋 Interactive session ended. Returning to terminal.\n');
    process.exit(0);
  }
}

/**
 * Helper to create and start blessed interactive mode
 */
export async function startBlessedInteractive(options = {}) {
  const interactive = new BlessedInteractive(options);
  await interactive.start();
  return interactive;
}
