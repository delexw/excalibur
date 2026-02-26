/**
 * Gemini parser - handles Google Gemini CLI output format
 * 
 * Extracts JSON from markdown code blocks or raw JSON output.
 */

import { BaseParser } from './base.js';

export class GeminiParser extends BaseParser {
  /**
   * Check if this parser can handle Gemini output
   * @param {string} stdout - Raw stdout
   * @returns {boolean} True if output contains Gemini markers
   */
  canHandle(stdout: string): boolean {
    return stdout.includes('gemini') || stdout.includes('```json');
  }

  /**
   * Parse Gemini CLI output
   * @param {string} stdout - Raw stdout from Gemini CLI
   * @returns {string} Normalized JSON text
   */
  parse(stdout: string): string {
    let txt = stdout;

    // Strip ANSI escape codes
    txt = this._stripAnsi(txt);

    // Handle markdown code blocks if present
    if (txt.includes('```json')) {
      const jsonStart = txt.indexOf('```json') + 7;
      const jsonEnd = txt.indexOf('```', jsonStart);
      if (jsonEnd > jsonStart) {
        txt = txt.slice(jsonStart, jsonEnd).trim();
      }
    }

    // Find the outermost JSON object
    const first = txt.indexOf('{');
    const last = txt.lastIndexOf('}');

    if (first >= 0 && last > first) {
      const jsonCandidate = txt.slice(first, last + 1).trim();

      try {
        JSON.parse(jsonCandidate);
        return jsonCandidate;
      } catch (e) {
        return txt.trim();
      }
    }

    return txt.trim();
  }

  /**
   * Strip ANSI escape codes from text
   * @param {string} text - Text with ANSI codes
   * @returns {string} Clean text
   */
  _stripAnsi(text: string): string {
    return text
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\x1B\][^\x07]*\x07/g, '')
      .replace(/\x1B[P\]^_][^\x07\x1B]*[\x07\x1B]/g, '');
  }
}
