/**
 * Default parser - handles generic JSON extraction
 * 
 * This is the fallback parser that works with most agent CLIs.
 * It extracts the outermost JSON object from the output.
 */

import { BaseParser } from './base.js';

export class DefaultParser extends BaseParser {
  /**
   * Check if this parser can handle any stdout
   * @param {string} stdout - Raw stdout
   * @returns {boolean} Always true - this is the fallback
   */
  canHandle(stdout) {
    return true;
  }

  /**
   * Parse generic JSON output
   * @param {string} stdout - Raw stdout from agent
   * @returns {string} Normalized JSON text
   */
  parse(stdout) {
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
  _stripAnsi(text) {
    return text
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\x1B\][^\x07]*\x07/g, '')
      .replace(/\x1B[P\]^_][^\x07\x1B]*[\x07\x1B]/g, '');
  }
}
