#!/usr/bin/env node
// LaPis postinstall — rebuilds native modules + installs AGENTS.md to Pi agent config
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 1. Rebuild better-sqlite3 if needed
try {
  require('better-sqlite3');
} catch {
  try {
    execSync('npm rebuild better-sqlite3', { stdio: 'inherit' });
  } catch {
    console.warn('[lapis] Could not rebuild better-sqlite3. Run `npm rebuild better-sqlite3` manually.');
  }
}

// 2. Install AGENTS.md to ~/.pi/agent/ if LaPis is installed as a dependency
//    (skip if we're developing LaPis itself — detected by checking if package.json
//     Has lapis as its own name and we're in the LaPis repo)
const pkgPath = path.resolve(__dirname, 'package.json');
try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  // Only install AGENTS.md if LaPis is installed as a dependency elsewhere
  // (not when developing LaPis in its own repo)
  const piAgentDir = path.join(os.homedir(), '.pi', 'agent');
  const agentsDest = path.join(piAgentDir, 'AGENTS.md');
  const agentsSrc = path.resolve(__dirname, 'skills', 'memory-layer', 'AGENTS.md');

  if (fs.existsSync(agentsSrc) && fs.existsSync(piAgentDir)) {
    // Don't overwrite if user has a customized AGENTS.md
    if (!fs.existsSync(agentsDest)) {
      fs.copyFileSync(agentsSrc, agentsDest);
      console.log('[lapis] Installed AGENTS.md to ~/.pi/agent/');
    } else {
      // Check if the existing file is an older version of ours
      const existing = fs.readFileSync(agentsDest, 'utf8');
      const ours = fs.readFileSync(agentsSrc, 'utf8');
      if (existing !== ours && existing.includes('memory-layer')) {
        // It's ours but outdated — update it
        fs.copyFileSync(agentsSrc, agentsDest);
        console.log('[lapis] Updated AGENTS.md in ~/.pi/agent/');
      }
    }
  }
} catch {
  // Non-critical — AGENTS.md install is best-effort
}
