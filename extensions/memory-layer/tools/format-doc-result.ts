export function formatDocResult(mode: string, result: any): string {
  switch (mode) {
    case "search": {
      const items = result.results || [];
      return `**Doc search:** ${items.length} results\n${items.slice(0, 15).map((r: any) => `  [${r.role}] (L${r.level}) ${r.title} — ${r.file_path}`).join("\n")}`;
    }
    case "outline": {
      if (Array.isArray(result)) {
        const walk = (nodes: any[], indent: number) =>
          nodes.map((n: any) => `${'  '.repeat(indent)}${'#'.repeat(Math.min(n.level || 1, 6))} ${n.title} [${n.role}]\n${n.children?.length ? walk(n.children, indent + 1) : ''}`).join('');
        return walk(result, 0);
      }
      const files = result.files || [];
      return `**Docs:** ${files.length} files\n${files.map((f: any) => `  ${f.path} (${f.section_count} sections)`).join("\n")}`;
    }
    case "backlinks": {
      const bl = result.backlinks || [];
      return `**Backlinks:** ${bl.length}\n${bl.map((b: any) => `  ← ${b.source_file}#${b.source_title} ("${b.link_text}")`).join("\n")}`;
    }
    case "broken-links": {
      const bad = result.broken_links || [];
      return `**Broken links:** ${bad.length}\n${bad.slice(0, 20).map((l: any) => `  ${l.source_file}: "${l.link_text}" → ${l.target_path}`).join("\n")}`;
    }
    case "glossary": {
      if (result.error) {return result.error;}
      if (Array.isArray(result)) {
        return `**Glossary:** ${result.length} terms\n${result.slice(0, 20).map((t: any) => `  **${t.term}** — ${t.definition.slice(0, 80)}`).join("\n")}`;
      }
      return `**${result.term}** — ${result.definition}`;
    }
    case "tutorial-path": {
      const chain = result.chain || [];
      return `**Tutorial path:**\n${chain.map((c: any, i: number) => `  ${i + 1}. ${c.title} (section #${c.section_id})`).join("\n")}`;
    }
    case "code-examples": {
      const examples = result.results || [];
      return `**Code examples:** ${examples.length}\n${examples.map((e: any) => `  ${e.section_title} (${e.file_path}) [${e.lang}]:\n${e.content.slice(0, 150)}...`).join("\n\n")}`;
    }
    case "orphans": {
      if (!result.orphans?.length) {return "No orphan sections found — all sections have inbound links.";}
      return `Found ${result.total} orphan sections:\n\n${ 
        result.orphans.map((s: any) =>
          `- **${s.title}** (L${s.level}) — ${s.file_path.split("/").pop()} [${s.role || "other"}]`
        ).join("\n")}`;
    }
    case "coverage": {
      return `Doc coverage: ${result.coverage_pct}% (${result.documented}/${result.total_symbols} symbols documented)\n\n` +
        `**Documented** (showing up to 20):\n${ 
        result.documented_list.map((s: any) => `  ✅ ${s.name} (${s.kind}) — ${s.file_path.split("/").pop()}`).join("\n") 
        }\n\n**Undocumented** (showing up to 20):\n${ 
        result.undocumented_list.map((s: any) => `  ❌ ${s.name} (${s.kind}) — ${s.file_path.split("/").pop()}`).join("\n")}`;
    }
    case "stale-pages": {
      if (!result.stale?.length && !result.missing?.length) {return "No stale or missing pages found. Docs are up to date.";}
      let out = "";
      if (result.stale?.length) {
        out += `**Stale pages** (${result.stale.length} modified since index):\n${ 
          result.stale.map((s: any) => `  📝 ${s.path} (indexed: ${new Date(s.indexed_mtime).toISOString().slice(0,19)}, current: ${new Date(s.current_mtime).toISOString().slice(0,19)})`).join("\n")}`;
      }
      if (result.missing?.length) {
        if (out) {out += "\n";}
        out += `**Missing pages** (${result.missing.length} deleted since index):\n${ 
          result.missing.map((s: any) => `  🗑️ ${s.path}`).join("\n")}`;
      }
      return out;
    }
    case "duplicates": {
      if (!result.duplicates?.length) {return "No duplicate sections found.";}
      return `Found ${result.total_duplicate_groups} duplicate groups:\n\n${ 
        result.duplicates.map((d: any) =>
          `**Hash ${d.content_hash.slice(0, 8)}...** (${d.count} copies)\n` +
          d.sections.map((s: any) => `  - "${s.title}" in ${s.file_path.split("/").pop()}`).join("\n")
        ).join("\n\n")}`;
    }
    default:
      return JSON.stringify(result, null, 2).slice(0, 2000);
  }
}
