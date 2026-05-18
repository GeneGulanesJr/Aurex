function safePop(val: any): string {
  if (typeof val === 'string') {return val.split('/').pop() ?? val;}
  return String(val ?? '');
}

function formatCodeResult(mode: string, result: any): string {
  switch (mode) {
    case 'callers':
    case 'callees': {
      const items = result.callers || result.callees || [];
      const dir = mode === 'callers' ? 'Callers of' : 'Callees from';
      const lines = items.map((c: any) => `  [depth ${c.depth ?? '?'}] ${c.name ?? '?'} (${c.file_path ?? '?'})`);
      return `**${dir} ${result.symbol ?? '?'}:**\n${lines.length ? lines.join('\n') : '(none found)'}`;
    }
    case 'blast-radius': {
      const aFiles = result.affected_files || [];
      const callers = result.callers || [];
      const importers = result.file_importers || [];
      return [
        `**Blast radius of ${result.symbol ?? '?'}** (${result.file ?? '?'})`,
        `Affected files: ${aFiles.length}`,
        callers.length
          ? `\nCallers:\n${callers.map((c: any) => `  [depth ${c.depth ?? '?'}] ${c.name ?? '?'} (${c.file_path ?? '?'})`).join('\n')}`
          : '',
        importers.length
          ? `\nFile importers:\n${importers.map((f: any) => `  [depth ${f.depth ?? '?'}] ${f.path ?? '?'}`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');
    }
    case 'dead-code': {
      const deadFiles = result.dead_files || [];
      const deadSyms = result.dead_symbols || [];
      return [
        `**Dead code analysis** — ${deadFiles.length} dead files, ${deadSyms.length} dead symbols`,
        deadFiles.length ? `Dead files:\n${deadFiles.map((f: any) => `  ${f.path ?? '?'}`).join('\n')}` : '',
        deadSyms
          .slice(0, 20)
          .map(
            (s: any) =>
              `  [${s.confidence ?? '?'}] ${s.name ?? '?'} (${s.file ?? '?'}) — ${(s.signals || []).join(', ')}`,
          )
          .join('\n'),
      ]
        .filter(Boolean)
        .join('\n');
    }
    case 'complexity': {
      if (Array.isArray(result)) {
        const high = result.filter((r: any) => r.assessment === 'high');
        const med = result.filter((r: any) => r.assessment === 'medium');
        return [
          `**Complexity:** ${result.length} functions — ${high.length} high, ${med.length} medium, ${result.length - high.length - med.length} low`,
          ...high
            .slice(0, 10)
            .map(
              (r: any) =>
                `  🔴 ${r.name ?? '?'} (${safePop(r.file_path)}): cyclomatic=${r.cyclomatic ?? '?'} nesting=${r.nesting_depth ?? '?'}`,
            ),
          ...med.slice(0, 5).map((r: any) => `  🟡 ${r.name ?? '?'}: cyclomatic=${r.cyclomatic ?? '?'}`),
        ].join('\n');
      }
      return `**${result.name ?? '?'}** (${safePop(result.file_path)}): cyclomatic=${result.cyclomatic ?? '?'} nesting=${result.nesting_depth ?? '?'} params=${result.param_count ?? '?'} lines=${result.lines_of_code ?? '?'} — ${result.assessment ?? '?'}`;
    }
    case 'deps': {
      const edges = result.edges || [];
      const down = result.downstream || [];
      const up = result.upstream || [];
      if (down.length || up.length) {
        return [
          down.length
            ? `**Downstream:**\n${down.map((d: any) => `  [${d.depth ?? '?'}] ${d.path ?? '?'}`).join('\n')}`
            : '',
          up.length ? `**Upstream:**\n${up.map((u: any) => `  [${u.depth ?? '?'}] ${u.path ?? '?'}`).join('\n')}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      }
      return `**Import graph:** ${edges.length} edges\n${edges
        .slice(0, 20)
        .map((e: any) => `  ${e.source ?? '?'} → ${e.target ?? '?'} (${e.type ?? '?'})`)
        .join('\n')}`;
    }
    case 'outline': {
      const outline = result;
      if (outline.classes) {
        const lines = outline.classes.map((c: any) => {
          const methods = (c.methods || [])
            .map(
              (m: any) =>
                `    ${m.assessment ? `[${m.assessment}] ` : ''}${m.kind ?? '?'} ${m.name ?? '?'}${m.signature ? `: ${m.signature.slice(0, 60)}` : ''}`,
            )
            .join('\n');
          return `  📦 ${c.name ?? '?'}\n${methods}`;
        });
        const standalone = (outline.standalone || []).map(
          (s: any) =>
            `  ${s.assessment ? `[${s.assessment}] ` : ''}${s.kind ?? '?'} ${s.name ?? '?'}${s.signature ? `: ${s.signature.slice(0, 60)}` : ''}`,
        );
        return `**File outline**\n${[...lines, ...standalone].join('\n')}`;
      }
      return JSON.stringify(outline, null, 2);
    }
    case 'churn': {
      if (result.error) {
        return `Error: ${result.error}`;
      }
      if (result.repo) {
        return `**${result.repo}** churn (${result.window_days ?? '?'}d): ${result.total_files_changed ?? 0} files changed\n${(
          result.top_files || []
        )
          .slice(0, 10)
          .map((f: any) => `  ${f.file ?? '?'}: ${f.commits ?? 0} commits (${f.churn_per_week ?? '?'}/wk)`)
          .join('\n')}`;
      }
      return `**Churn:** ${result.commits ?? 0} commits, ${result.unique_authors ?? 0} authors (${result.churn_per_week ?? '?'}/wk)\n  First: ${result.first_seen ?? '?'} | Last: ${result.last_modified ?? '?'}`;
    }
    case 'hotspots': {
      if (!result.hotspots?.length) {
        return `No hotspots found${result.note ? ` (${result.note})` : '.'}`;
      }
      return result.hotspots
        .map(
          (h: any, i: number) =>
            `${i + 1}. **${h.name ?? '?'}** (${h.kind ?? '?'}) — ${safePop(h.file_path)}\n   Risk: ${h.risk ?? '?'} | Score: ${h.hotspot_score ?? '?'} | Complexity: ${h.cyclomatic ?? '?'} | Commits: ${h.commits ?? 0} | Churn: ${h.churn_per_week ?? '?'}/wk`,
        )
        .join('\n\n');
    }
    case 'cycles': {
      if (!result.cycles?.length) {
        return 'No dependency cycles found — import graph is acyclic.';
      }
      return result.cycles
        .map(
          (c: any, i: number) =>
            `${i + 1}. **Cycle ${i + 1}** (${c.size ?? '?'} files)\n   Files: ${(c.files || []).map((f: string) => safePop(f)).join(' → ')}\n   Edges: ${(c.edges || []).map((e: any) => `${safePop(e.from)} → ${safePop(e.to)}`).join(', ')}`,
        )
        .join('\n\n');
    }
    case 'importance': {
      if (!result.importance?.length) {
        return 'No symbols found.';
      }
      return `Top ${result.importance.length} of ${result.total_symbols ?? result.importance.length} symbols by PageRank:\n\n${result.importance
        .map(
          (s: any, i: number) =>
            `${i + 1}. **${s.name ?? '?'}** (${s.kind ?? '?'}) — ${safePop(s.file_path)} — PageRank: ${s.pagerank ?? '?'}`,
        )
        .join('\n')}`;
    }
    case 'coupling': {
      if (!result.metrics?.length) {
        return 'No coupling data found.';
      }
      return result.metrics
        .map((m: any) => {
          const short = safePop(m.file_path);
          return `**${short}** (${m.category ?? '?'})\n   Ca=${m.afferent ?? 0} Ce=${m.efferent ?? 0} I=${m.instability ?? '?'}`;
        })
        .join('\n\n');
    }
    case 'extractable': {
      if (!result.candidates?.length) {
        return 'No extraction candidates found. Try lowering --min-complexity or --min-callers.';
      }
      return result.candidates
        .map(
          (c: any, i: number) =>
            `${i + 1}. **${c.name ?? '?'}** (${c.kind ?? '?'}) — ${safePop(c.file_path)}\n   Score: ${c.extraction_score ?? '?'} | Complexity: ${c.cyclomatic ?? '?'} | Callers: ${c.caller_file_count ?? 0} files\n   Called from: ${(c.caller_files || []).map((f: string) => safePop(f)).join(', ')}`,
        )
        .join('\n\n');
    }
    case 'hierarchy': {
      if (result.error) {
        return `Error: ${result.error}`;
      }
      let out = `**${result.name ?? '?'}** (${result.kind ?? '?'}) — ${safePop(result.file_path)}`;
      if (result.ancestors?.length) {
        out += `\n\nAncestors: ${result.ancestors.map((a: any) => `${a.name ?? '?'} (${a.kind ?? '?'})`).join(' → ')}`;
      }
      if (result.descendants?.length) {
        out += `\n\nMembers: ${result.descendants.map((d: any) => `${d.name ?? '?'} (${d.kind ?? '?'})`).join(', ')}`;
      }
      if (!result.ancestors?.length && !result.descendants?.length) {
        out += `\n\n(No parent classes or child members found)`;
      }
      return out;
    }
    case 'signal-chains': {
      if (!result.chains?.length) {
        return result.note || 'No signal chains found.';
      }
      return result.chains
        .map((c: any) => {
          const gw = c.gateway || c;
          const label = gw.method ? `${gw.method} ${gw.path ?? ''}` : (gw.name ?? '?');
          return `▶ **${label}** (${gw.kind ?? '?'})\n${(c.chain || [])
            .map((s: any, i: number) => `${'  '.repeat(i + 1)}→ ${s.name ?? '?'} (${s.kind || 'fn'})`)
            .join('\n')}`;
        })
        .join('\n\n');
    }
    case 'layer-violations': {
      if (result.error) {
        return `Error: ${result.error}`;
      }
      if (result.note) {
        return result.note;
      }
      if (!result.violations?.length) {
        return 'No layer violations found.';
      }
      return result.violations
        .map(
          (v: any) =>
            `❌ **${v.source_layer ?? '?'}** → **${v.target_layer ?? '?'}**: ${safePop(v.source)} imports ${safePop(v.target)}\n   Rule: ${v.rule ?? '?'}`,
        )
        .join('\n\n');
    }
    case 'index-repo': {
      if (result.error) {
        return `Error: ${result.error}`;
      }
      return `✅ Repo "${result.name || result.repo}" indexed: ${result.file_count || 0} files, ${result.symbol_count || 0} symbols`;
    }
    case 'reindex-repo': {
      if (result.error) {
        return `Error: ${result.error}`;
      }
      return `✅ Repo "${result.name || result.repo}" reindexed: ${result.file_count || 0} files, ${result.symbol_count || 0} symbols (${result.mode || 'incremental'})`;
    }
    case 'index-docs': {
      if (result.error) {
        return `Error: ${result.error}`;
      }
      return `✅ Doc repo "${result.name || result.repo}" indexed: ${result.section_count || 0} sections in ${result.file_count || 0} files`;
    }
    case 'reindex-docs': {
      if (result.error) {
        return `Error: ${result.error}`;
      }
      return `✅ Doc repo "${result.name || result.repo}" reindexed: ${result.section_count || 0} sections (${result.mode || 'full'})`;
    }
    default:
      return JSON.stringify(result, null, 2).slice(0, 2000);
  }
}

function formatDocResult(mode: string, result: any): string {
  switch (mode) {
    case 'search': {
      const items = result.results || [];
      return `**Doc search:** ${items.length} results\n${items
        .slice(0, 15)
        .map((r: any) => `  [${r.role ?? '?'}] (L${r.level ?? '?'}) ${r.title ?? '?'} — ${r.file_path ?? '?'}`)
        .join('\n')}`;
    }
    case 'outline': {
      if (Array.isArray(result)) {
        const walk = (nodes: any[], indent: number) =>
          nodes
            .map(
              (n: any) =>
                `${'  '.repeat(indent)}${'#'.repeat(Math.min(n.level || 1, 6))} ${n.title} [${n.role}]\n${n.children?.length ? walk(n.children, indent + 1) : ''}`,
            )
            .join('');
        return walk(result, 0);
      }
      const files = result.files || [];
      return `**Docs:** ${files.length} files\n${files.map((f: any) => `  ${f.path} (${f.section_count} sections)`).join('\n')}`;
    }
    case 'backlinks': {
      const bl = result.backlinks || [];
      return `**Backlinks:** ${bl.length}\n${bl.map((b: any) => `  ← ${b.source_file ?? '?'}#${b.source_title ?? '?'} ("${b.link_text ?? ''}")`).join('\n')}`;
    }
    case 'broken-links': {
      const bad = result.broken_links || [];
      return `**Broken links:** ${bad.length}\n${bad
        .slice(0, 20)
        .map((l: any) => `  ${l.source_file ?? '?'}: "${l.link_text ?? ''}" → ${l.target_path ?? '?'}`)
        .join('\n')}`;
    }
    case 'glossary': {
      if (result.error) {
        return result.error;
      }
      if (Array.isArray(result)) {
        return `**Glossary:** ${result.length} terms\n${result
          .slice(0, 20)
          .map((t: any) => `  **${t.term ?? '?'}** — ${(t.definition ?? '').slice(0, 80)}`)
          .join('\n')}`;
      }
      return `**${result.term ?? '?'}** — ${result.definition ?? ''}`;
    }
    case 'tutorial-path': {
      const chain = result.chain || [];
      return `**Tutorial path:**\n${chain.map((c: any, i: number) => `  ${i + 1}. ${c.title ?? '?'} (section #${c.section_id ?? '?'})`).join('\n')}`;
    }
    case 'code-examples': {
      const examples = result.results || [];
      return `**Code examples:** ${examples.length}\n${examples.map((e: any) => `  ${e.section_title ?? '?'} (${e.file_path ?? '?'}) [${e.lang ?? '?'}]:\n${(e.content ?? '').slice(0, 150)}...`).join('\n\n')}`;
    }
    case 'orphans': {
      if (!result.orphans?.length) {
        return 'No orphan sections found — all sections have inbound links.';
      }
      return `Found ${result.total ?? result.orphans.length} orphan sections:\n\n${result.orphans
        .map(
          (s: any) => `- **${s.title ?? '?'}** (L${s.level ?? '?'}) — ${safePop(s.file_path)} [${s.role || 'other'}]`,
        )
        .join('\n')}`;
    }
    case 'coverage': {
      return (
        `Doc coverage: ${result.coverage_pct ?? '?'}% (${result.documented ?? 0}/${result.total_symbols ?? 0} symbols documented)\n\n` +
        `**Documented** (showing up to 20):\n${(result.documented_list || [])
          .map((s: any) => `  ✅ ${s.name ?? '?'} (${s.kind ?? '?'}) — ${safePop(s.file_path)}`)
          .join('\n')}\n\n**Undocumented** (showing up to 20):\n${(result.undocumented_list || [])
          .map((s: any) => `  ❌ ${s.name ?? '?'} (${s.kind ?? '?'}) — ${safePop(s.file_path)}`)
          .join('\n')}`
      );
    }
    case 'stale-pages': {
      if (!result.stale?.length && !result.missing?.length) {
        return 'No stale or missing pages found. Docs are up to date.';
      }
      let out = '';
      if (result.stale?.length) {
        out += `**Stale pages** (${result.stale.length} modified since index):\n${result.stale
          .map(
            (s: any) =>
              `  📝 ${s.path ?? '?'} (indexed: ${s.indexed_mtime ? new Date(s.indexed_mtime).toISOString().slice(0, 19) : '?'}, current: ${s.current_mtime ? new Date(s.current_mtime).toISOString().slice(0, 19) : '?'})`,
          )
          .join('\n')}`;
      }
      if (result.missing?.length) {
        if (out) {
          out += '\n';
        }
        out += `**Missing pages** (${result.missing.length} deleted since index):\n${result.missing
          .map((s: any) => `  🗑️ ${s.path ?? '?'}`)
          .join('\n')}`;
      }
      return out || 'No stale or missing pages found.';
    }
    case 'duplicates': {
      if (!result.duplicates?.length) {
        return 'No duplicate sections found.';
      }
      return `Found ${result.total_duplicate_groups ?? result.duplicates.length} duplicate groups:\n\n${result.duplicates
        .map(
          (d: any) =>
            `**Hash ${(d.content_hash ?? '').slice(0, 8)}...** (${d.count ?? '?'} copies)\n${(d.sections || []).map((s: any) => `  - "${s.title ?? '?'}" in ${safePop(s.file_path)}`).join('\n')}`,
        )
        .join('\n\n')}`;
    }
    default:
      return JSON.stringify(result, null, 2).slice(0, 2000);
  }
}

export { formatCodeResult, formatDocResult };
