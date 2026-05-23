#!/usr/bin/env node
// Paired Pi memory benchmark.
//
// This harness runs the same task pack twice:
//   1. memory off: vanilla Pi, no LaPis extension/skills/context
//   2. memory on: Pi with LaPis available
//
// It intentionally does not simulate the no-memory baseline. Both sides are
// External commands let the benchmark capture real token usage and answers.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_TASKS = path.join(__dirname, 'fixtures', 'pi-memory-tasks.json');
const PI_CONFIG_FILES = ['models.json', 'settings.json', 'auth.json'];
const MEMORY_OFF_EMPTY_SETTINGS = new Set(['packages']);

function parseArgs(argv) {
  const args = {
    tasks: DEFAULT_TASKS,
    outDir: path.join('bench', 'results', `pi-paired-${new Date().toISOString().replace(/[:.]/g, '-')}`),
    only: null,
    timeoutMs: 10 * 60 * 1000,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tasks') {
      args.tasks = argv[++i];
    } else if (arg === '--out-dir') {
      args.outDir = argv[++i];
    } else if (arg === '--only') {
      args.only = argv[++i];
    } else if (arg === '--timeout-ms') {
      args.timeoutMs = parseInt(argv[++i], 10);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node bench/bench-pi-paired.js

By default, this runs:
  1. memory off: Pi with a temporary HOME that copies only config/auth files
  2. memory on:  Pi from your normal HOME

Command templates may use:
  {prompt}   shell-quoted benchmark prompt
  {task_id}  task id
  {repo}     repo name from the fixture
  {out}      shell-quoted output file path

Options:
  --only TASK_ID       Run one task
  --timeout-ms N       Per-side timeout, default 600000

Override example:
  BENCH_PI_MEMORY_OFF_CMD='pi --print --mode json --no-session {prompt} > {out} 2>&1' \\
  BENCH_PI_MEMORY_ON_CMD='pi --print --mode json --no-session {prompt} > {out} 2>&1' \\
  node bench/bench-pi-paired.js`);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function renderCommand(template, task, repo, outFile) {
  return template
    .replaceAll('{prompt}', shellQuote(task.prompt))
    .replaceAll('{task_id}', task.id)
    .replaceAll('{repo}', repo)
    .replaceAll('{out}', shellQuote(outFile));
}

function defaultPiCommand(homeDir = null) {
  const homePrefix = homeDir ? `HOME=${shellQuote(homeDir)} ` : '';
  return `${homePrefix}pi --print --mode json --no-session {prompt} > {out} 2>&1`;
}

function prepareNoMemoryHome(outDir) {
  const sourceAgentDir = path.join(os.homedir(), '.pi', 'agent');
  const homeDir = path.join(outDir, '.pi-memory-off-home');
  const targetAgentDir = path.join(homeDir, '.pi', 'agent');
  fs.mkdirSync(targetAgentDir, { recursive: true });

  for (const file of PI_CONFIG_FILES) {
    const source = path.join(sourceAgentDir, file);
    if (fs.existsSync(source)) {
      const target = path.join(targetAgentDir, file);
      if (file === 'settings.json') {
        fs.writeFileSync(target, `${JSON.stringify(sanitizeMemoryOffSettings(source), null, 2)}\n`);
      } else {
        fs.copyFileSync(source, target);
      }
    }
  }

  return homeDir;
}

function sanitizeMemoryOffSettings(settingsPath) {
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  for (const key of MEMORY_OFF_EMPTY_SETTINGS) {
    if (Array.isArray(settings[key])) {
      settings[key] = [];
    }
  }
  return settings;
}

function runCommand(command, cwd, timeoutMs, outFile) {
  const started = Date.now();
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(command, {
      cwd,
      shell: true,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const progress = setInterval(() => {
      const size = fs.existsSync(outFile) ? fs.statSync(outFile).size : 0;
      console.error(`[bench] still running after ${Math.round((Date.now() - started) / 1000)}s, transcript ${size} bytes`);
    }, 5000);

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGTERM');
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearInterval(progress);
        clearTimeout(timeout);
        resolve({
          status: null,
          signal: null,
          elapsed_ms: Date.now() - started,
          stdout,
          stderr,
          error: error.message,
        });
      }
    });
    child.on('close', (status, signal) => {
      if (!settled) {
        settled = true;
      }
      clearInterval(progress);
      clearTimeout(timeout);
      resolve({
        status,
        signal,
        elapsed_ms: Date.now() - started,
        stdout,
        stderr,
        error: signal === 'SIGTERM' ? `Timed out after ${timeoutMs}ms` : null,
      });
    });
  });
}

function parsePiOutput(raw) {
  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    active_tokens: 0,
    total_tokens: 0,
    cost_usd: 0,
  };
  const assistantParts = [];
  const toolCounts = new Map();

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    let event;
    if (trimmed) {
      try {
        event = JSON.parse(trimmed);
      } catch {
        event = null;
      }
    }
    if (event) {
      const type = event.type || '';
      const message = event.message || event.delta || event;
      const eventUsage = message.usage || event.usage;
      if (eventUsage) {
        usage.input_tokens += eventUsage.input || eventUsage.input_tokens || 0;
        usage.output_tokens += eventUsage.output || eventUsage.output_tokens || 0;
        usage.cache_read_tokens += eventUsage.cacheRead || eventUsage.cache_read_tokens || 0;
        usage.cache_write_tokens += eventUsage.cacheWrite || eventUsage.cache_write_tokens || 0;
        const cost = eventUsage.cost || {};
        usage.cost_usd += cost.total || eventUsage.cost_usd || 0;
      }

      const content = message.content || event.content;
      if (message.role === 'assistant' && typeof content === 'string') {
        assistantParts.push(content);
      } else if (message.role === 'assistant' && Array.isArray(content)) {
        for (const part of content) {
          if (part && part.type === 'text' && part.text) {
            assistantParts.push(part.text);
          }
        }
      } else if ((type.includes('text') || type.includes('message')) && typeof event.text === 'string') {
        assistantParts.push(event.text);
      }

      const toolName = event.name || event.tool || event.tool_name || event.input?.tool;
      if (toolName && /tool|command|exec|read|search|memory/i.test(type + toolName)) {
        toolCounts.set(toolName, (toolCounts.get(toolName) || 0) + 1);
      }
    }
  }

  usage.active_tokens = usage.input_tokens + usage.output_tokens;
  usage.total_tokens = usage.active_tokens + usage.cache_read_tokens;
  return {
    usage,
    answer: assistantParts.join('\n').trim() || raw.trim(),
    tool_counts: Object.fromEntries(toolCounts.entries()),
  };
}

function gradeAnswer(answer, expectedFacts) {
  const normalized = answer.toLowerCase();
  const facts = expectedFacts.map((fact) => {
    const aliases = fact.aliases || [fact.description];
    const matched_aliases = aliases.filter((alias) => normalized.includes(String(alias).toLowerCase()));
    return {
      id: fact.id,
      description: fact.description,
      matched: matched_aliases.length > 0,
      matched_aliases,
    };
  });
  const matched = facts.filter((fact) => fact.matched).length;
  return {
    matched,
    total: facts.length,
    score: facts.length > 0 ? matched / facts.length : 0,
    facts,
  };
}

async function runSide(side, commandTemplate, task, repo, outDir, cwd, timeoutMs) {
  const outFile = path.join(outDir, `${task.id}.${side}.jsonl`);
  const command = renderCommand(commandTemplate, task, repo, outFile);
  console.error(`[bench] ${task.id}: starting ${side}`);
  const run = await runCommand(command, cwd, timeoutMs, outFile);
  console.error(`[bench] ${task.id}: finished ${side} in ${run.elapsed_ms}ms`);

  let raw = '';
  if (fs.existsSync(outFile)) {
    raw = fs.readFileSync(outFile, 'utf-8');
  }
  if (!raw && (run.stdout || run.stderr)) {
    raw = `${run.stdout}\n${run.stderr}`;
  }

  const parsed = parsePiOutput(raw);
  const grade = gradeAnswer(parsed.answer, task.expected_facts || []);

  return {
    side,
    command,
    output_file: outFile,
    status: run.status,
    signal: run.signal,
    elapsed_ms: run.elapsed_ms,
    error: run.error,
    usage: parsed.usage,
    tool_counts: parsed.tool_counts,
    grade,
  };
}

function printRow(taskId, off, on) {
  const offTokens = off.usage.active_tokens || 0;
  const onTokens = on.usage.active_tokens || 0;
  const savings = offTokens > 0 ? `${Math.round((1 - onTokens / offTokens) * 100)}%` : 'n/a';
  const offScore = `${off.grade.matched}/${off.grade.total}`;
  const onScore = `${on.grade.matched}/${on.grade.total}`;
  console.log(
    [
      taskId.padEnd(24),
      offScore.padEnd(9),
      onScore.padEnd(9),
      String(offTokens).padStart(10),
      String(onTokens).padStart(10),
      savings.padStart(8),
      String(off.elapsed_ms).padStart(9),
      String(on.elapsed_ms).padStart(9),
    ].join('  '),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const taskPack = JSON.parse(fs.readFileSync(args.tasks, 'utf-8'));
  const repo = taskPack.repo || path.basename(process.cwd());
  const tasks = (taskPack.tasks || []).filter((task) => !args.only || task.id === args.only);
  if (tasks.length === 0) {
    console.error(`No tasks matched ${args.only || args.tasks}`);
    process.exit(2);
  }

  const outDir = path.resolve(args.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const noMemoryHome = prepareNoMemoryHome(outDir);
  const offCommand = process.env.BENCH_PI_MEMORY_OFF_CMD || defaultPiCommand(noMemoryHome);
  const onCommand = process.env.BENCH_PI_MEMORY_ON_CMD || defaultPiCommand();

  console.log(`[bench] memory-off HOME: ${noMemoryHome}`);
  if (!process.env.BENCH_PI_MEMORY_OFF_CMD || !process.env.BENCH_PI_MEMORY_ON_CMD) {
    console.log('[bench] using default Pi commands; set BENCH_PI_MEMORY_OFF_CMD / BENCH_PI_MEMORY_ON_CMD to override');
  }
  console.log('');
  const results = [];
  console.log(`${'Task'.padEnd(24)}  OffFacts   OnFacts    OffActive   OnActive  Savings      OffMs      OnMs`);
  console.log('-'.repeat(96));
  for (const task of tasks) {
    const taskOutDir = path.join(outDir, task.id);
    fs.mkdirSync(taskOutDir, { recursive: true });
    // Sequential runs keep memory-off and memory-on from sharing live Pi state.
    // eslint-disable-next-line no-await-in-loop
    const off = await runSide('memory-off', offCommand, task, repo, taskOutDir, process.cwd(), args.timeoutMs);
    // eslint-disable-next-line no-await-in-loop
    const on = await runSide('memory-on', onCommand, task, repo, taskOutDir, process.cwd(), args.timeoutMs);
    results.push({
      task_id: task.id,
      category: task.category || 'uncategorized',
      intent: task.intent || null,
      prompt: task.prompt,
      memory_off: off,
      memory_on: on,
    });
    printRow(task.id, off, on);
  }

  const summary = buildSummary(results);
  const report = { generated_at: new Date().toISOString(), host: os.hostname(), task_pack: args.tasks, summary, results };
  const reportPath = path.join(outDir, 'report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log('\nSummary');
  console.log(`  Tasks:             ${summary.tasks}`);
  console.log(`  Memory-off facts:  ${summary.memory_off_facts}`);
  console.log(`  Memory-on facts:   ${summary.memory_on_facts}`);
  console.log(`  Memory-off active: ${summary.memory_off_active_tokens}`);
  console.log(`  Memory-on active:  ${summary.memory_on_active_tokens}`);
  console.log(`  Memory-off cache:  ${summary.memory_off_cache_read_tokens}`);
  console.log(`  Memory-on cache:   ${summary.memory_on_cache_read_tokens}`);
  console.log(`  Token delta:       ${summary.token_savings_pct}`);
  console.log('');
  console.log('By category:');
  for (const category of summary.categories) {
    console.log(
      `  ${category.category}: facts ${category.memory_off_facts} -> ${category.memory_on_facts}, active ${category.memory_off_active_tokens} -> ${category.memory_on_active_tokens}, delta ${category.token_savings_pct}`,
    );
  }
  console.log(`  Report:            ${reportPath}`);
}

function buildSummary(results) {
  const sum = results.reduce(
    (acc, result) => {
      acc.tasks++;
      acc.offMatched += result.memory_off.grade.matched;
      acc.offTotal += result.memory_off.grade.total;
      acc.onMatched += result.memory_on.grade.matched;
      acc.onTotal += result.memory_on.grade.total;
      acc.offTokens += result.memory_off.usage.active_tokens || 0;
      acc.onTokens += result.memory_on.usage.active_tokens || 0;
      acc.offCache += result.memory_off.usage.cache_read_tokens || 0;
      acc.onCache += result.memory_on.usage.cache_read_tokens || 0;
      return acc;
    },
    {
      tasks: 0,
      offMatched: 0,
      offTotal: 0,
      onMatched: 0,
      onTotal: 0,
      offTokens: 0,
      onTokens: 0,
      offCache: 0,
      onCache: 0,
    },
  );
  return {
    tasks: sum.tasks,
    memory_off_facts: `${sum.offMatched}/${sum.offTotal}`,
    memory_on_facts: `${sum.onMatched}/${sum.onTotal}`,
    memory_off_active_tokens: sum.offTokens,
    memory_on_active_tokens: sum.onTokens,
    memory_off_cache_read_tokens: sum.offCache,
    memory_on_cache_read_tokens: sum.onCache,
    token_savings_pct: sum.offTokens > 0 ? `${((1 - sum.onTokens / sum.offTokens) * 100).toFixed(1)}%` : 'n/a',
    categories: buildCategorySummary(results),
  };
}

function buildCategorySummary(results) {
  const groups = new Map();
  for (const result of results) {
    const category = result.category || 'uncategorized';
    if (!groups.has(category)) {
      groups.set(category, {
        category,
        tasks: 0,
        offMatched: 0,
        offTotal: 0,
        onMatched: 0,
        onTotal: 0,
        offTokens: 0,
        onTokens: 0,
      });
    }
    const group = groups.get(category);
    group.tasks++;
    group.offMatched += result.memory_off.grade.matched;
    group.offTotal += result.memory_off.grade.total;
    group.onMatched += result.memory_on.grade.matched;
    group.onTotal += result.memory_on.grade.total;
    group.offTokens += result.memory_off.usage.active_tokens || 0;
    group.onTokens += result.memory_on.usage.active_tokens || 0;
  }

  return [...groups.values()].map((group) => ({
    category: group.category,
    tasks: group.tasks,
    memory_off_facts: `${group.offMatched}/${group.offTotal}`,
    memory_on_facts: `${group.onMatched}/${group.onTotal}`,
    memory_off_active_tokens: group.offTokens,
    memory_on_active_tokens: group.onTokens,
    token_savings_pct:
      group.offTokens > 0 ? `${((1 - group.onTokens / group.offTokens) * 100).toFixed(1)}%` : 'n/a',
  }));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
