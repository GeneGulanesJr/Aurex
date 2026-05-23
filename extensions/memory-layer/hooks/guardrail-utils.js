'use strict';

// Minimum pattern length to be considered a targeted lookup (not a broad scan)
const MIN_SYMBOL_LENGTH = 4;
// Regex to extract the quoted search pattern from grep/rg commands
// We want the LAST quoted string (the actual search pattern), not flags like --include="*.js"
const QUOTED_PATTERN_RE = /(?:['"])([^'"]+)(?:['"])/g;
// Pipes that are NOT just head/tail (which are fine for targeted lookups)
// The \s* must be INSIDE the negative lookahead so it's part of the assertion
const COMPLEX_PIPE_RE = /\|(?!\s*(?:head|tail)\b)/;

/**
 * Determine if a bash grep/rg command is a targeted single-symbol lookup
 * (e.g., `grep -rn "rankObservations" src/`) rather than a broad scan
 * (e.g., `grep -rn "ctx" src/` or `find src -name "*.ts"`).
 *
 * Targeted lookups are allowed through the guardrail because they're faster
 * than memory-code search for exact-name queries.
 */
function isTargetedSymbolLookup(cmd) {
  // 'find' is never a targeted symbol lookup
  if (/\bfind\b/.test(cmd)) return false;

  // Must have grep/rg/ag/ack
  if (!/\b(grep|rg|ag|ack)\b/.test(cmd)) return false;

  // No complex pipe chains (allow | head, | tail)
  if (COMPLEX_PIPE_RE.test(cmd)) return false;

  // Extract the LAST quoted search pattern (not flags like --include="*.js")
  let lastMatch = null;
  let m;
  while ((m = QUOTED_PATTERN_RE.exec(cmd)) !== null) {
    lastMatch = m[1];
  }
  if (!lastMatch) return false;

  const pattern = lastMatch;

  // Pattern must be long enough to be targeted (not broad)
  if (pattern.length < MIN_SYMBOL_LENGTH) return false;

  // No wildcards or regex metacharacters in the pattern
  if (/[.*+?|^$()\[\]{}\\]/.test(pattern)) return false;

  // No OR patterns (pipes inside the pattern)
  if (pattern.includes('|')) return false;

  return true;
}

module.exports = { isTargetedSymbolLookup };
