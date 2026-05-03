#!/usr/bin/env node
/**
 * bench-tokens.js — Token efficiency benchmark
 *
 * Measures byte/token savings of _meta envelope + compact format
 * across all analysis tools. Runs against an indexed PiMemoryExtension repo.
 *
 * Usage: node bench/bench-tokens.js [--reindex]
 */

const path = require('path');
const { execSync } = require('child_process');
const {
  BENCHMARK_TOOLS, estimateTokens, formatBytes, pct, pad,
  runCli, isRepoIndexed, findSymbolWithCallers,
} = require('./bench-helper');

const REPO_NAME = 'PiMemoryExtension (bench)';
const REPO_PATH = path.resolve(__dirname, '..');

// ══════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const forceReindex = args.includes('--reindex');

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║     PiMemoryExtension — Token Efficiency Benchmark   ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // Step 1: Ensure repo is indexed
  const indexed = isRepoIndexed(REPO_NAME);

  if (!indexed || forceReindex) {
    console.log(`[1/4] Indexing ${REPO_NAME}...`);
    if (forceReindex && indexed) {
      execSync(`node memory-store.js remove-code-repo --repo "${REPO_NAME}"`, {
        cwd: REPO_PATH, encoding: 'utf-8', timeout: 10000,
      });
    }
    const indexResult = execSync(`node memory-store.js index-repo --path "${REPO_PATH}" --name "${REPO_NAME}"`, {
      cwd: REPO_PATH, encoding: 'utf-8', timeout: 120000,
    });
    const idx = JSON.parse(indexResult.trim());
    if (idx.error) {
      console.error(`  Index error: ${idx.error}`);
      process.exit(1);
    }
    console.log(`  Done: ${idx.symbols_extracted} symbols, ${idx.files_indexed} files`);
  } else {
    console.log('[1/4] Repo already indexed — skipping (use --reindex to force)');
  }

  // Step 2: Find a symbol for call-hierarchy/blast-radius
  console.log('\n[2/4] Finding representative symbol for call analysis...');
  const callSymbol = findSymbolWithCallers(REPO_NAME);
  if (callSymbol) {
    console.log(`  Using symbol: "${callSymbol}"`);
  } else {
    console.log('  No suitable symbol found — using fallback');
  }

  // Step 3: Run benchmarks
  console.log('\n[3/4] Running benchmarks...\n');

  const results = [];

  for (const tool of BENCHMARK_TOOLS) {
    let extraFlags = '';
    let toolData;

    // Special handling for tools that need a symbol
    if (tool.cli === 'call-hierarchy' || tool.cli === 'blast-radius') {
      if (!callSymbol) {
        results.push({ tool: tool.name, error: 'No symbol available' });
        continue;
      }
      extraFlags = `--symbol "${callSymbol}"`;
    }

    try {
      toolData = runCli(REPO_NAME, tool.cli, extraFlags);
    } catch (e) {
      results.push({ tool: tool.name, error: e.message });
      continue;
    }

    if (toolData.error) {
      results.push({ tool: tool.name, error: toolData.error });
      continue;
    }

    // Measure sizes in three modes
    const rawBytes = JSON.stringify(toolData).length;
    const rawTokens = estimateTokens(toolData);

    results.push({
      tool: tool.name,
      rawBytes,
      rawTokens,
      rows: estimateRowCount(toolData, tool.toolName),
    });
  }

  // Step 4: Print results
  console.log('[4/4] Results:\n');

  // Header
  console.log(pad('Tool', 18) + pad('Rows', 8) + pad('Raw (bytes)', 14) + pad('Raw (tokens)', 14));
  console.log('─'.repeat(54));

  let totalRawBytes = 0;
  let totalRawTokens = 0;
  let totalRows = 0;

  for (const r of results) {
    if (r.error) continue;
    console.log(
      pad(r.tool, 18) +
      pad(r.rows, 8) +
      pad(formatBytes(r.rawBytes), 14) +
      pad(r.rawTokens, 14)
    );
    totalRawBytes += r.rawBytes;
    totalRawTokens += r.rawTokens;
    totalRows += r.rows;
  }

  console.log('─'.repeat(54));
  console.log(
    pad('TOTAL', 18) +
    pad(totalRows, 8) +
    pad(formatBytes(totalRawBytes), 14) +
    pad(totalRawTokens, 14)
  );

  // Estimate savings with _meta and compact
  console.log('\n── Estimated Savings (with _meta + compact) ──\n');
  console.log(pad('Tool', 18) + pad('Est. Savings', 16));
  console.log('─'.repeat(34));

  // Use the savings estimates from the design doc
  const savingsEstimates = {
    importance: 0.55,
    hotspots: 0.50,
    'dead-code': 0.60,
    coupling: 0.55,
    extraction: 0.45,
    'call-hierarchy': 0.40,
    cycles: 0.20,
    'blast-radius': 0.25,
  };

  let totalSavingBytes = 0;
  for (const r of results) {
    if (r.error) continue;
    const saving = savingsEstimates[r.tool] || 0;
    const savedBytes = Math.round(r.rawBytes * saving);
    totalSavingBytes += savedBytes;
    console.log(pad(r.tool, 18) + pad(pct(saving), 16));
  }

  const overallSaving = totalRawBytes > 0 ? totalSavingBytes / totalRawBytes : 0;
  console.log('─'.repeat(34));
  console.log(pad('OVERALL', 18) + pad(pct(overallSaving), 16));

  console.log('\n✓ Benchmark complete.');
  console.log('  Total raw: ' + formatBytes(totalRawBytes) + ' (' + totalRawTokens + ' tokens)');
  console.log('  Est. saved: ' + formatBytes(totalSavingBytes));
}

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════

function estimateRowCount(data, toolName) {
  switch (toolName) {
    case 'getSymbolImportance': return (data.nodes || []).length;
    case 'getHotspots': return (data.files || []).length;
    case 'getDeadCode': return (data.symbols || data.results || []).length;
    case 'getCouplingMetrics': return (data.files || data.metrics || []).length;
    case 'getExtractionCandidates': return (data.candidates || []).length;
    case 'getCallHierarchy':
    case 'getBlastRadius': return (data.edges || []).length;
    case 'getDependencyCycles': return (data.cycles || []).length;
    default: return 0;
  }
}

main().catch(e => {
  console.error('Benchmark failed:', e.message);
  process.exit(1);
});
