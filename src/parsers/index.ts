/**
 * Parser registry - Factory for creating parser instances
 * 
 * Provides a way to register and retrieve parsers by name.
 * Supports both static parsers and parser classes that can handle streaming.
 */

import { DefaultParser } from './default.js';
import { CodexParser } from './codex.js';
import { GeminiParser } from './gemini.js';
import { BaseParser } from './base.js';
import type { Agent } from '../types.js';

const parserRegistry = new Map<string, new () => BaseParser>();

export function registerParser(name: string, parserClass: new () => BaseParser): void {
  parserRegistry.set(name.toLowerCase(), parserClass);
}

registerParser('default', DefaultParser);
registerParser('codex', CodexParser);
registerParser('gemini', GeminiParser);

/**
 * Get a parser instance by name
 * @param {string} name - Parser name (e.g., 'codex', 'default')
 * @returns {BaseParser} Parser instance
 */
export function getParser(name?: string): BaseParser {
  const ParserClass = parserRegistry.get(name?.toLowerCase());
  if (!ParserClass) {
    return new DefaultParser();
  }
  return new ParserClass();
}

/**
 * Get parser for an agent based on configuration
 * @param {Object} agent - Agent configuration from agents.json
 * @returns {BaseParser} Parser instance
 */
export function getParserForAgent(agent: Agent): BaseParser {
  if (agent.responseParser) {
    return getParser(agent.responseParser);
  }
  return new DefaultParser();
}

export { DefaultParser } from './default.js';
export { CodexParser } from './codex.js';
export { GeminiParser } from './gemini.js';
export { BaseParser, ParseResult } from './base.js';
