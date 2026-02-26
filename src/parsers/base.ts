/**
 * Base parser interface for agent output normalization
 *
 * Implement this interface to create custom parsers for different agents.
 * Each parser handles the unique output format of specific AI CLI tools.
 */

import type { AgentResponsePayload } from '../types.js';

export class BaseParser {
  /**
   * Parse raw stdout from an agent CLI and return normalized JSON text
   * @param {string} stdout - Raw stdout from the agent process
   * @returns {string} Normalized JSON text suitable for JSON.parse()
   */
  parse(stdout: string): string {
    throw new Error('Parser must implement parse() method');
  }

  /**
   * Check if this parser can handle the given stdout
   * @param {string} stdout - Raw stdout from the agent process
   * @returns {boolean} True if this parser can handle the output
   */
  canHandle(stdout: string): boolean {
    throw new Error('Parser must implement canHandle() method');
  }
}

/**
 * Parse result wrapper
 */
export class ParseResult {
  ok: boolean;
  json: AgentResponsePayload;
  raw: string;
  error?: string;

  constructor({ ok, json, raw, error }: { ok: boolean; json: AgentResponsePayload; raw: string; error?: string }) {
    this.ok = ok;
    this.json = json;
    this.raw = raw;
    this.error = error;
  }
}
