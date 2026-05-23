// Shared utilities for scope builders.

/**
 * Add a binding to the bindings array with deduplication.
 * Deduplicates by (name, lineStart, scopeDepth) — the same name can appear
 * at different scope depths in the same file (e.g., shadowed variables).
 */
function addBinding(bindings, binding) {
  // Basic validation
  if (!binding.name || typeof binding.lineStart !== 'number' || typeof binding.lineEnd !== 'number') {
    return;
  }
  bindings.push(binding);
}

/**
 * Deduplicate bindings that have identical (name, kind, origin, lineStart, scopeDepth).
 * Keeps the first occurrence.
 */
function dedupBindings(bindings) {
  const seen = new Set();
  return bindings.filter((b) => {
    const key = `${b.name}\0${b.kind}\0${b.origin}\0${b.lineStart}\0${b.scopeDepth}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

module.exports = { addBinding, dedupBindings };
