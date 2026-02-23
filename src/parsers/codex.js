/**
 * Codex parser - handles OpenAI Codex CLI output format
 * 
 * Extracts JSON content between "codex" line and "tokens used" line.
 */

import { BaseParser } from './base.js';

export class CodexParser extends BaseParser {
  /**
   * Check if this parser can handle Codex output
   * @param {string} stdout - Raw stdout
   * @returns {boolean} True if output contains Codex markers
   */
  canHandle(stdout) {
    return stdout.includes('OpenAI Codex') || stdout.includes('codex\n');
  }

  /**
   * Parse Codex CLI output
   * @param {string} stdout - Raw stdout from Codex CLI
   * @returns {string} Normalized JSON text
   */
  parse(stdout) {
    let txt = stdout;

    // Strip ANSI escape codes
    txt = this._stripAnsi(txt);

    const lines = txt.split('\n');
    let codexLineIdx = -1;
    let tokensLineIdx = -1;

    // Find the line that is exactly "codex" or "[timestamp] codex"
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === 'codex' || /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\]\s*codex$/.test(line)) {
        codexLineIdx = i;
        break;
      }
    }

    // Find the line that contains "tokens used" after the codex line
    if (codexLineIdx >= 0) {
      for (let i = codexLineIdx + 1; i < lines.length; i++) {
        if (lines[i].includes('tokens used')) {
          tokensLineIdx = i;
          break;
        }
      }
    }

    // Extract content between these two lines
    if (codexLineIdx >= 0 && tokensLineIdx > codexLineIdx) {
      const contentLines = lines.slice(codexLineIdx + 1, tokensLineIdx).filter(line => line.trim() !== '');
      txt = contentLines.join('\n').trim();
    } else if (codexLineIdx >= 0) {
      const contentLines = lines.slice(codexLineIdx + 1).filter(line => line.trim() !== '');
      txt = contentLines.join('\n').trim();
    }

    // Try to validate the extracted JSON immediately
    try {
      JSON.parse(txt);
      return txt;
    } catch (e) {
      // If JSON parsing fails, try to find just the outermost braces
      const first = txt.indexOf('{');
      const last = txt.lastIndexOf('}');
      if (first >= 0 && last > first) {
        const candidate = txt.slice(first, last + 1);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch (e2) {
          return txt;
        }
      }
      return txt;
    }
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
