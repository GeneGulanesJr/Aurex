'use strict';

// Minimum pattern length to be considered a targeted lookup (not a broad scan)
const MIN_SYMBOL_LENGTH = 4;
// Regex to extract the quoted search pattern from grep/rg commands
// We want the LAST quoted string (the actual search pattern), not flags like --include="*.js"
const QUOTED_PATTERN_RE = /(?:['"])([^'"]+)(?:['"])/g;
const SEARCH_COMMAND_RE = /\b(grep|rg|ag|ack|find)\b/;
const FILTER_COMMAND_RE = /^\s*(grep|rg|ag|ack)\b/;
const SIMPLE_LIMIT_PIPE_RE = /^\s*(?:head|tail)\b/;
const CODE_FILE_PATH_RE = /(?:^|\s)(?:\.{0,2}\/|\/)?[^\s'"]+\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)(?:\s|$)/;

function splitPipeline(cmd) {
  const stages = [];
  let current = '';
  let quote = null;

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    const prev = i > 0 ? cmd[i - 1] : '';

    if ((ch === '"' || ch === "'") && prev !== '\\') {
      quote = quote === ch ? null : quote || ch;
    }

    if (ch === '|' && !quote) {
      stages.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  stages.push(current.trim());
  return stages.filter(Boolean);
}

function isPipedOutputFilter(cmd) {
  const stages = splitPipeline(cmd);
  if (stages.length < 2) {
    return false;
  }

  const [sourceStage, ...filterStages] = stages;
  if (SEARCH_COMMAND_RE.test(sourceStage)) {
    return false;
  }

  return filterStages.some((stage) => FILTER_COMMAND_RE.test(stage));
}

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
  if (/\bfind\b/.test(cmd)) {
    return false;
  }

  // Must have grep/rg/ag/ack
  if (!/\b(grep|rg|ag|ack)\b/.test(cmd)) {
    return false;
  }

  // No complex pipe chains (allow | head, | tail). Use splitPipeline so quoted
  // Regex pipes do not count as shell pipelines.
  const stages = splitPipeline(cmd);
  if (stages.length > 1 && stages.slice(1).some((stage) => !SIMPLE_LIMIT_PIPE_RE.test(stage))) {
    return false;
  }

  // Extract the first quoted search pattern that is not a glob option value.
  // Some grep invocations put --include after the search pattern, so
  // Last-quoted-string parsing misclassifies them.
  let pattern = null;
  let hasQuotedPattern = false;
  let m;
  while ((m = QUOTED_PATTERN_RE.exec(cmd)) !== null) {
    const candidate = m[1];
    if (!/^[*?]/.test(candidate)) {
      hasQuotedPattern = true;
    }
    if (!/[*?]/.test(candidate)) {
      pattern = candidate;
      break;
    }
  }

  // Searching within one explicit source file is bounded enough to allow even
  // When the pattern is a small structural regex such as `return {`.
  if (hasQuotedPattern && CODE_FILE_PATH_RE.test(cmd)) {
    return true;
  }

  if (!pattern) {
    return false;
  }

  // Pattern must be long enough to be targeted (not broad)
  if (pattern.length < MIN_SYMBOL_LENGTH) {
    return false;
  }

  // No wildcards or regex metacharacters in the pattern
  if (/[.*+?|^$()\[\]{}\\]/.test(pattern)) {
    return false;
  }

  // No OR patterns (pipes inside the pattern)
  if (pattern.includes('|')) {
    return false;
  }

  return true;
}

module.exports = { isPipedOutputFilter, isTargetedSymbolLookup };
