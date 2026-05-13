/**
 * Doc-indexer.js — Markdown section extraction, link analysis, glossary, code examples
 *
 * Regex-based markdown parser. Zero dependencies beyond Node.js builtins.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RESULT_LIMITS } = require('./constants');

// Guard: reject calls when db handle is not available (CLI fallback mode)
const _DB_ERROR = Object.freeze({
  error:
    'This operation requires a native SQLite backend (node:sqlite or better-sqlite3). The CLI fallback does not support doc indexing.',
});

function _withDb(fn) {
  return function _guarded(db, ...args) {
    if (!db || typeof db.prepare !== 'function') {return _DB_ERROR;}
    return fn(db, ...args);
  };
}

const _MD_EXTENSIONS = new Set(['.md', '.mdx']);
const _IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '__pycache__',
  '.next',
  '.nuxt',
  'dist',
  'build',
  '.cache',
  '.pi',
  'vendor',
]);

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── Role classification ──
const _ROLE_PATTERNS = [
  { pattern: /tutorial|getting.?started|quickstart|walkthrough/i, role: 'tutorial' },
  { pattern: /api|reference|endpoint|method/i, role: 'api' },
  { pattern: /how.?to|guide|cookbook/i, role: 'how_to' },
  { pattern: /concept|overview|architecture|design|philosophy/i, role: 'concept' },
  { pattern: /troubleshoot|debug|fix|common.?error|pitfall/i, role: 'troubleshooting' },
  { pattern: /changelog|release|history|what.?new/i, role: 'changelog' },
  { pattern: /faq|q&a|frequently/i, role: 'faq' },
  { pattern: /example|demo|sample|snippet/i, role: 'example' },
];

function classifyRole(title, content) {
  const text = `${title} ${(content || '').slice(0, 200)}`;
  for (const { pattern, role } of _ROLE_PATTERNS) {
    if (pattern.test(text)) {return role;}
  }
  return 'other';
}

function extractTags(content) {
  const tags = new Set();
  const re = /(?<!#)#(\w{2,})/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    tags.add(match[1].toLowerCase());
  }
  return [...tags].join(',');
}

// ── Markdown section parser ──
function parseMarkdownSections(content, filePath) {
  const sections = [];
  const lines = content.split('\n');
  const lineByteOffsets = [0];
  for (let l = 0; l < lines.length; l++) {
    lineByteOffsets.push(lineByteOffsets[l] + lines[l].length + 1);
  }

  let i = 0;
  // Skip YAML frontmatter
  if (lines[0] && lines[0].trim() === '---') {
    i = 1;
    while (i < lines.length && lines[i].trim() !== '---') {i++;}
    i++;
  }

  let currentSection = null;
  let hasHeadings = false;

  while (i < lines.length) {
    const line = lines[i];
    const atxMatch = line.match(/^(#{1,6})\s+(.+)$/);
    const setextMatch = i + 1 < lines.length && (lines[i + 1].match(/^={3,}\s*$/) || lines[i + 1].match(/^-{3,}\s*$/));

    if (atxMatch) {
      hasHeadings = true;
      if (currentSection) {
        currentSection.content = lines.slice(currentSection._startLine, i).join('\n').trim();
        currentSection.byte_end = lineByteOffsets[i];
        currentSection.content_hash = hashContent(currentSection.content);
        currentSection.role = classifyRole(currentSection.title, currentSection.content);
        currentSection.tags = extractTags(currentSection.content);
        sections.push(currentSection);
      }
      const level = atxMatch[1].length;
      const title = atxMatch[2].replace(/\s*#+\s*$/, '').trim();
      currentSection = {
        title,
        level,
        content: '',
        byte_start: lineByteOffsets[i],
        byte_end: 0,
        _startLine: i + 1,
        role: 'other',
        tags: '',
        content_hash: '',
      };
      i++;
      continue;
    }

    if (setextMatch) {
      hasHeadings = true;
      if (currentSection) {
        currentSection.content = lines.slice(currentSection._startLine, i).join('\n').trim();
        currentSection.byte_end = lineByteOffsets[i];
        currentSection.content_hash = hashContent(currentSection.content);
        currentSection.role = classifyRole(currentSection.title, currentSection.content);
        currentSection.tags = extractTags(currentSection.content);
        sections.push(currentSection);
      }
      const level = lines[i + 1].includes('=') ? 1 : 2;
      currentSection = {
        title: line.trim(),
        level,
        content: '',
        byte_start: lineByteOffsets[i],
        byte_end: 0,
        _startLine: i + 2,
        role: 'other',
        tags: '',
        content_hash: '',
      };
      i += 2;
      continue;
    }

    i++;
  }

  if (currentSection) {
    currentSection.content = lines.slice(currentSection._startLine, i).join('\n').trim();
    currentSection.byte_end = lineByteOffsets[i] || content.length;
    currentSection.content_hash = hashContent(currentSection.content);
    currentSection.role = classifyRole(currentSection.title, currentSection.content);
    currentSection.tags = extractTags(currentSection.content);
    sections.push(currentSection);
  }

  if (!hasHeadings) {
    sections.push({
      title: path.basename(filePath),
      level: 0,
      content: content.trim(),
      byte_start: 0,
      byte_end: content.length,
      role: 'other',
      tags: extractTags(content),
      content_hash: hashContent(content),
    });
  }

  return sections;
}

// ── Section hierarchy builder ──
function buildSectionHierarchy(sections) {
  const stack = [];
  const result = [];
  for (let idx = 0; idx < sections.length; idx++) {
    const sec = sections[idx];
    while (stack.length > 0 && stack[stack.length - 1].level >= sec.level) {stack.pop();}
    result.push({ ...sec, parent_idx: stack.length > 0 ? stack[stack.length - 1].idx : null });
    stack.push({ level: sec.level, idx });
  }
  return result;
}

// ── Link extraction ──
function extractLinks(content) {
  // Strip fenced code blocks first to avoid matching links inside code
  const stripped = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '');
  const links = [];
  const re = /\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = re.exec(stripped)) !== null) {
    // Skip image references ![alt](url)
    const prefix = stripped.substring(Math.max(0, match.index - 1), match.index);
    if (prefix === '!') {continue;}
    const target = match[2];
    // Skip empty, regex, or malformed targets
    if (
      !target ||
      target.startsWith('[^') ||
      (target.startsWith('http') === false && /[^\w\/.\-#_~]/.test(target.replace(/\#.*/, '')))
    ) {
      // Allow: paths, anchors, URLs. Skip: regex patterns, empty strings
      if (
        !target.startsWith('/') &&
        !target.startsWith('./') &&
        !target.startsWith('../') &&
        !target.startsWith('#') &&
        !target.startsWith('http')
      )
        {continue;}
    }
    const isInternal = !target.match(/^https?:\/\//) && !target.startsWith('mailto:');
    links.push({ target_path: target, link_text: match[1], is_internal: isInternal });
  }
  return links;
}

function isInternalLink(href) {
  if (!href) {return false;}
  if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {return false;}
  return href.startsWith('/') || href.startsWith('./') || href.startsWith('../') || href.startsWith('#');
}

// ── Glossary extraction ──
function extractGlossaryTerms(content) {
  const terms = [];
  const re = /\*\*([^*]+)\*\*\s*[—:–-]\s*(.+)/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    const term = match[1].trim();
    const def = match[2].trim().replace(/\s+/g, ' ');
    if (term.length > 1 && term.length < 60 && def.length > 5) {
      terms.push({ term: term.toLowerCase(), definition: def });
    }
  }
  return terms;
}

// ── Code block extraction ──
function extractCodeBlocks(content, sectionByteStart) {
  const blocks = [];
  const lines = content.split('\n');
  let inBlock = false;
  let lang = '';
  let blockContent = [];
  let blockStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBlock && line.match(/^```/)) {
      inBlock = true;
      lang = line.replace(/^```\s*/, '').trim();
      blockContent = [];
      blockStartLine = i;
      continue;
    }
    if (inBlock && line.match(/^```\s*$/)) {
      inBlock = false;
      const blockText = blockContent.join('\n');
      const preBytes = lines.slice(0, blockStartLine).reduce((s, l) => s + l.length + 1, 0);
      blocks.push({
        lang: lang || '',
        content: blockText,
        byte_start: sectionByteStart + preBytes,
        byte_end: sectionByteStart + preBytes + blockText.length + 7,
      });
      continue;
    }
    if (inBlock) {blockContent.push(line);}
  }
  return blocks;
}

// ── Directory walker ──
function walkDir(dirPath, ignoreGlob) {
  const results = [];
  const ignoreRe = ignoreGlob ? new RegExp(ignoreGlob.replace(/\*/g, '.*').replace(/\?/g, '.')) : null;

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) {continue;}
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (_IGNORE_DIRS.has(entry.name)) {continue;}
        if (ignoreRe && ignoreRe.test(fullPath)) {continue;}
        walk(fullPath);
      } else if (entry.isFile() && _MD_EXTENSIONS.has(path.extname(entry.name))) {
        if (ignoreRe && ignoreRe.test(fullPath)) {continue;}
        results.push(fullPath);
      }
    }
  }

  walk(dirPath);
  return results;
}

// ── Main indexing function ──
async function indexDocs(db, rootPath, repoName, ignoreGlob) {
  if (!fs.existsSync(rootPath)) {return { error: `Path not found: ${rootPath}` };}

  // Upsert repo — handle cases where name OR path already exists
  let repoId;
  const existingByName = db.prepare('SELECT id FROM doc_repos WHERE name = ?').get(repoName);
  const existingByPath = db.prepare('SELECT id FROM doc_repos WHERE path = ?').get(rootPath);
  if (existingByName) {
    repoId = existingByName.id;
    if (existingByName.id !== existingByPath?.id) {
      db.prepare('UPDATE doc_repos SET path = ? WHERE id = ?').run(rootPath, repoId);
    }
    db.prepare('DELETE FROM doc_code_blocks WHERE section_id IN (SELECT id FROM doc_sections WHERE repo_id = ?)').run(
      repoId,
    );
    db.prepare('DELETE FROM doc_links WHERE source_section_id IN (SELECT id FROM doc_sections WHERE repo_id = ?)').run(
      repoId,
    );
    db.prepare('DELETE FROM doc_terms WHERE repo_id = ?').run(repoId);
    db.prepare('DELETE FROM doc_sections WHERE repo_id = ?').run(repoId);
    db.prepare('DELETE FROM doc_files WHERE repo_id = ?').run(repoId);
  } else if (existingByPath) {
    repoId = existingByPath.id;
    db.prepare('UPDATE doc_repos SET name = ? WHERE id = ?').run(repoName, repoId);
    db.prepare('DELETE FROM doc_code_blocks WHERE section_id IN (SELECT id FROM doc_sections WHERE repo_id = ?)').run(
      repoId,
    );
    db.prepare('DELETE FROM doc_links WHERE source_section_id IN (SELECT id FROM doc_sections WHERE repo_id = ?)').run(
      repoId,
    );
    db.prepare('DELETE FROM doc_terms WHERE repo_id = ?').run(repoId);
    db.prepare('DELETE FROM doc_sections WHERE repo_id = ?').run(repoId);
    db.prepare('DELETE FROM doc_files WHERE repo_id = ?').run(repoId);
  } else {
    const repoRow = db.prepare('INSERT INTO doc_repos (name, path) VALUES (?, ?) RETURNING id').get(repoName, rootPath);
    repoId = repoRow.id;
  }

  const files = walkDir(rootPath, ignoreGlob);
  let totalSections = 0,
    totalLinks = 0,
    totalTerms = 0,
    totalCodeBlocks = 0;

  const insertFile = db.prepare(
    'INSERT INTO doc_files (repo_id, path, content, content_hash, mtime) VALUES (?, ?, ?, ?, ?) RETURNING id',
  );
  const insertSection = db.prepare(
    'INSERT INTO doc_sections (repo_id, file_id, title, level, parent_id, content, content_hash, byte_start, byte_end, role, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
  );
  const insertLink = db.prepare(
    'INSERT INTO doc_links (source_section_id, target_path, target_section_id, link_text, is_broken) VALUES (?, ?, ?, ?, ?)',
  );
  const insertTerm = db.prepare(
    'INSERT OR IGNORE INTO doc_terms (repo_id, term, definition, section_id) VALUES (?, ?, ?, ?)',
  );
  const insertCodeBlock = db.prepare(
    'INSERT INTO doc_code_blocks (section_id, lang, content, byte_start, byte_end) VALUES (?, ?, ?, ?, ?)',
  );

  const BATCH_SIZE = RESULT_LIMITS.DOC_BATCH_SIZE;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const reads = await Promise.all(batch.map(async (fp) => {
      try {
        const [content, stat] = await Promise.all([
          fs.promises.readFile(fp, 'utf-8'),
          fs.promises.stat(fp),
        ]);
        return { filePath: fp, content, stat };
      } catch (e) {
        return null;
      }
    }));

    for (const entry of reads) {
      if (!entry) {continue;}
      const { filePath, content, stat } = entry;
      const relPath = path.relative(rootPath, filePath);

      const fileRow = insertFile.get(repoId, relPath, content, hashContent(content), stat.mtimeMs);
      const fileId = fileRow.id;

      const sections = parseMarkdownSections(content, filePath);
      const withParent = buildSectionHierarchy(sections);
      const sectionIdMap = new Map();

      for (let idx = 0; idx < withParent.length; idx++) {
        const sec = withParent[idx];
        const parentId = sec.parent_idx !== null ? sectionIdMap.get(sec.parent_idx) || null : null;

        const sectionRow = insertSection.get(
          repoId,
          fileId,
          sec.title,
          sec.level,
          parentId,
          sec.content,
          sec.content_hash,
          sec.byte_start,
          sec.byte_end,
          sec.role,
          sec.tags,
        );
        const sectionDbId = sectionRow.id;
        sectionIdMap.set(idx, sectionDbId);
        totalSections++;

        // Links
        const links = extractLinks(sec.content);
        for (const link of links) {
          if (link.is_internal) {
            insertLink.run(sectionDbId, link.target_path, null, link.link_text, 0);
            totalLinks++;
          }
        }

        // Glossary terms
        const terms = extractGlossaryTerms(sec.content);
        for (const term of terms) {
          insertTerm.run(repoId, term.term, term.definition, sectionDbId);
          totalTerms++;
        }

        // Code blocks
        const blocks = extractCodeBlocks(sec.content, sec.byte_start);
        for (const block of blocks) {
          insertCodeBlock.run(sectionDbId, block.lang, block.content, block.byte_start, block.byte_end);
          totalCodeBlocks++;
        }
      }
    }
  }

  // Resolve internal links
  const linkResults = resolveLinks(db, repoId);

  db.prepare(`UPDATE doc_repos SET file_count = ?, section_count = ?, updated_at = datetime('now') WHERE id = ?`).run(
    files.length,
    totalSections,
    repoId,
  );

  return {
    success: true,
    repo: repoName,
    files: files.length,
    sections: totalSections,
    links: totalLinks,
    terms: totalTerms,
    code_blocks: totalCodeBlocks,
    link_resolution: linkResults,
  };
}

// ── Link resolution ──
function resolveLinks(db, repoId) {
  let resolved = 0,
    broken = 0;

  const allLinks = db
    .prepare(`
    SELECT dl.id, dl.source_section_id, dl.target_path, ds.file_id, df.path as file_path
    FROM doc_links dl JOIN doc_sections ds ON ds.id = dl.source_section_id
    JOIN doc_files df ON df.id = ds.file_id
    WHERE ds.repo_id = ? AND dl.is_broken = 0
  `)
    .all(repoId);

  // Pre-load all sections and files to eliminate N+1 per-link queries
  const allSections = db.prepare('SELECT id, file_id, title FROM doc_sections WHERE repo_id = ?').all(repoId);
  const sectionsByFile = new Map();
  const sectionSlugCache = new Map();
  for (const s of allSections) {
    if (!sectionsByFile.has(s.file_id)) {sectionsByFile.set(s.file_id, []);}
    sectionsByFile.get(s.file_id).push(s);
    sectionSlugCache.set(s.id, slugify(s.title));
  }

  const allDocFiles = db.prepare('SELECT id, path FROM doc_files WHERE repo_id = ?').all(repoId);
  const docFileByPath = new Map();
  for (const f of allDocFiles) {
    docFileByPath.set(f.path, f);
    // Also index by trailing path segment for relative lookups
    const short = f.path.split('/').pop();
    if (short && !docFileByPath.has(short)) {docFileByPath.set(short, f);}
  }

  function findFileByPath(pathPart) {
    if (docFileByPath.has(pathPart)) {return docFileByPath.get(pathPart);}
    // Try suffix match
    for (const f of allDocFiles) {
      if (f.path.endsWith(`/${pathPart}`) || f.path === pathPart) {return f;}
    }
    return null;
  }

  function resolveAnchor(fileId, anchor) {
    const slug = slugify(anchor);
    const candidates = sectionsByFile.get(fileId) || [];
    for (const c of candidates) {
      const cSlug = sectionSlugCache.get(c.id);
      if (cSlug === slug || cSlug.startsWith(slug) || slug.startsWith(cSlug)) {
        return c.id;
      }
    }
    return null;
  }

  const updateStmt = db.prepare('UPDATE doc_links SET target_section_id = ? WHERE id = ?');
  const breakStmt = db.prepare('UPDATE doc_links SET is_broken = 1 WHERE id = ?');
  const firstSectionStmt = db.prepare('SELECT id FROM doc_sections WHERE file_id = ? LIMIT 1');

  for (const link of allLinks) {
    let targetSectionId = null;
    const href = link.target_path;

    if (href.startsWith('#')) {
      const slug = slugify(href.slice(1));
      const candidates = sectionsByFile.get(link.file_id) || [];
      for (const c of candidates) {
        const cSlug = sectionSlugCache.get(c.id);
        if (cSlug === slug || cSlug.startsWith(slug) || slug.startsWith(cSlug)) {
          targetSectionId = c.id;
          break;
        }
      }
    } else {
      let [pathPart, anchor] = href.split('#');
      pathPart = pathPart.replace(/^\.\/|^\.\.\//, '');

      let docFile = findFileByPath(pathPart);

      if (!docFile && !pathPart.endsWith('.md') && !pathPart.endsWith('.mdx')) {
        docFile = findFileByPath(`${pathPart}.md`);
      }

      if (docFile) {
        if (anchor) {
          targetSectionId = resolveAnchor(docFile.id, anchor);
        } else {
          targetSectionId = firstSectionStmt.get(docFile.id)?.id || null;
        }
      }
    }

    if (targetSectionId) {
      updateStmt.run(targetSectionId, link.id);
      resolved++;
    } else {
      breakStmt.run(link.id);
      broken++;
    }
  }

  return { resolved, broken };
}

// ── Query functions ──

function searchDocs(db, repoId, query, opts) {
  opts = opts || {};
  let sql = `SELECT ds.id, ds.title, ds.level, ds.role, ds.tags, ds.content_hash, df.path as file_path,
    length(ds.content) as content_length
    FROM doc_sections_fts
    JOIN doc_sections ds ON ds.id = doc_sections_fts.rowid
    JOIN doc_files df ON df.id = ds.file_id
    WHERE doc_sections_fts MATCH ? AND ds.repo_id = ?`;
  const params = [query, repoId];
  if (opts.level) {
    sql += ' AND ds.level = ?';
    params.push(opts.level);
  }
  if (opts.role) {
    sql += ' AND ds.role = ?';
    params.push(opts.role);
  }
  sql += ` ORDER BY rank LIMIT ${RESULT_LIMITS.DOC_SEARCH_LIMIT}`;
  try {
    const results = db.prepare(sql).all(...params);
    // V5.1: Compute answerability heuristic (shorter, code-rich sections score higher)
    for (const r of results) {
      const contentRow = db.prepare('SELECT content FROM doc_sections WHERE id = ?').get(r.id);
      if (contentRow) {
        const content = contentRow.content || '';
        const hasCode = content.includes('```');
        const codeRatio = (content.match(/```[\s\S]*?```/g) || []).join('').length / Math.max(content.length, 1);
        r.answerability = Math.min(
          1,
          (r.level >= 2 && r.level <= 4 ? 0.3 : 0.1) +
            (r.role === 'how_to' || r.role === 'tutorial'
              ? 0.3
              : r.role === 'api' || r.role === 'reference'
                ? 0.2
                : 0) +
            (content.length > 100 && content.length < 3000 ? 0.2 : 0.1) +
            (hasCode ? 0.2 : 0) +
            (codeRatio > 0.2 && codeRatio < 0.7 ? 0.1 : 0),
        );
      }
      delete r.content_hash;
      delete r.content_length;
    }
    return { results };
  } catch (e) {
    return { error: `Search failed: ${e.message}` };
  }
}

function getDocOutline(db, repoId, filePath) {
  if (filePath) {
    const file = db.prepare('SELECT id FROM doc_files WHERE repo_id = ? AND path LIKE ?').get(repoId, `%${filePath}%`);
    if (!file) {return { error: `Doc file not found: ${filePath}` };}
    const sections = db
      .prepare('SELECT id, title, level, parent_id, role FROM doc_sections WHERE file_id = ? ORDER BY byte_start')
      .all(file.id);
    return buildOutlineTree(sections);
  }
  const files = db
    .prepare(`
    SELECT df.path, COUNT(ds.id) as section_count FROM doc_files df LEFT JOIN doc_sections ds ON ds.file_id = df.id
    WHERE df.repo_id = ? GROUP BY df.id ORDER BY df.path
  `)
    .all(repoId);
  return { files };
}

function buildOutlineTree(sections) {
  const byId = new Map();
  for (const s of sections) {byId.set(s.id, { ...s, children: [] });}
  const roots = [];
  for (const s of sections) {
    const node = byId.get(s.id);
    if (s.parent_id && byId.has(s.parent_id)) {byId.get(s.parent_id).children.push(node);}
    else {roots.push(node);}
  }
  return roots;
}

function getBacklinks(db, repoId, docPath) {
  const targetFile = db
    .prepare('SELECT id FROM doc_files WHERE repo_id = ? AND path LIKE ?')
    .get(repoId, `%${docPath}%`);
  if (!targetFile) {return { error: `Doc file not found: ${docPath}` };}
  const targetSections = db.prepare('SELECT id FROM doc_sections WHERE file_id = ?').all(targetFile.id);
  const targetIds = targetSections.map((s) => s.id);
  if (!targetIds.length) {return { backlinks: [] };}

  const placeholders = targetIds.map(() => '?').join(',');
  const backlinks = db
    .prepare(`
    SELECT dl.target_path, dl.link_text, ds.title as source_title, df.path as source_file
    FROM doc_links dl JOIN doc_sections ds ON ds.id = dl.source_section_id JOIN doc_files df ON df.id = ds.file_id
    WHERE dl.target_section_id IN (${placeholders}) AND dl.is_broken = 0
  `)
    .all(...targetIds);
  return { backlinks };
}

function getBrokenLinks(db, repoId) {
  return db
    .prepare(`
    SELECT dl.target_path, dl.link_text, ds.title as source_title, df.path as source_file
    FROM doc_links dl JOIN doc_sections ds ON ds.id = dl.source_section_id JOIN doc_files df ON df.id = ds.file_id
    WHERE dl.is_broken = 1 AND ds.repo_id = ? ORDER BY df.path
  `)
    .all(repoId);
}

function lookupTerm(db, repoId, term) {
  if (term) {
    return (
      db.prepare('SELECT * FROM doc_terms WHERE repo_id = ? AND term = ?').get(repoId, term.toLowerCase()) || {
        error: `Term "${term}" not found`,
      }
    );
  }
  return db.prepare('SELECT * FROM doc_terms WHERE repo_id = ? ORDER BY term').all(repoId);
}

function getTutorialPath(db, repoId, sectionId) {
  const section = db.prepare('SELECT id, title, file_id, content FROM doc_sections WHERE id = ?').get(sectionId);
  if (!section) {return { error: `Section ${sectionId} not found` };}

  const chain = [{ section_id: section.id, title: section.title }];

  const nextMatch = (section.content || '').match(/[Nn]ext:?\s*\[([^\]]+)\]\(([^)]+)\)/);
  if (nextMatch) {
    const targetSection = db
      .prepare(`
      SELECT ds.id, ds.title FROM doc_sections ds JOIN doc_files df ON df.id = ds.file_id
      WHERE df.repo_id = ? AND df.path LIKE ? AND ds.level = ? LIMIT 1
    `)
      .get(repoId, `%${nextMatch[2]}%`, section.level);
    if (targetSection) {chain.push({ section_id: targetSection.id, title: targetSection.title });}
  }

  const file = db.prepare('SELECT path FROM doc_files WHERE id = ?').get(section.file_id);
  if (file) {
    const numMatch = file.path.match(/(\d+)-/);
    if (numMatch) {
      const currentNum = parseInt(numMatch[1]);
      const files = db.prepare('SELECT path FROM doc_files WHERE repo_id = ? ORDER BY path').all(repoId);
      const ordered = files
        .filter((f) => {
          const m = f.path.match(/(\d+)-/);
          return m && parseInt(m[1]) > currentNum;
        })
        .slice(0, 5);
      for (const nextFile of ordered) {
        const nextSection = db
          .prepare(
            'SELECT id, title FROM doc_sections WHERE file_id = (SELECT id FROM doc_files WHERE repo_id = ? AND path = ?) AND level = ? LIMIT 1',
          )
          .get(repoId, nextFile.path, section.level);
        if (nextSection) {chain.push({ section_id: nextSection.id, title: nextSection.title });}
      }
    }
  }

  return { chain };
}

function findCodeExamples(db, repoId, query, lang) {
  let sql = `SELECT dcb.id, dcb.lang, dcb.content, ds.title as section_title, df.path as file_path
    FROM doc_code_blocks dcb JOIN doc_sections ds ON ds.id = dcb.section_id JOIN doc_files df ON df.id = ds.file_id
    WHERE ds.repo_id = ? AND dcb.content LIKE ?`;
  const params = [repoId, `%${query}%`];
  if (lang) {
    sql += ' AND dcb.lang = ?';
    params.push(lang);
  }
  sql += ` LIMIT ${RESULT_LIMITS.DOC_CODE_EXAMPLES_LIMIT}`;
  return { results: db.prepare(sql).all(...params) };
}

async function reindexDocs(db, repoId, mode, ignoreGlob) {
  const repo = db.prepare('SELECT id, name, path FROM doc_repos WHERE id = ?').get(repoId);
  if (!repo) {return { error: `Repo ${repoId} not found` };}
  return indexDocs(db, repo.path, repo.name, ignoreGlob);
}

// ══════════════════════════════════════════════════════════
// ORPHAN SECTIONS (zero inbound links)
// ══════════════════════════════════════════════════════════

function getOrphanSections(db, repoId, opts = {}) {
  const includeSameDoc = opts.includeSameDoc || false;

  let query, params;
  if (includeSameDoc) {
    query = `
      SELECT ds.id, ds.title, ds.level, df.path as file_path, ds.role
      FROM doc_sections ds
      JOIN doc_files df ON df.id = ds.file_id
      WHERE ds.repo_id = ?
        AND ds.id NOT IN (SELECT DISTINCT target_section_id FROM doc_links WHERE target_section_id IS NOT NULL)
      ORDER BY ds.level, ds.title
    `;
    params = [repoId];
  } else {
    query = `
      SELECT ds.id, ds.title, ds.level, df.path as file_path, ds.role
      FROM doc_sections ds
      JOIN doc_files df ON df.id = ds.file_id
      WHERE ds.repo_id = ?
        AND ds.id NOT IN (
          SELECT DISTINCT dl.target_section_id
          FROM doc_links dl
          JOIN doc_sections src ON src.id = dl.source_section_id
          WHERE dl.target_section_id IS NOT NULL AND src.file_id != ds.file_id
        )
        AND ds.level > 1
      ORDER BY ds.level, ds.title
    `;
    params = [repoId];
  }

  const orphans = db.prepare(query).all(...params);
  return { orphans, total: orphans.length };
}

// ══════════════════════════════════════════════════════════
// DOC COVERAGE (which code symbols have documentation)
// ══════════════════════════════════════════════════════════

function getDocCoverage(db, repoId, docRepoId, opts = {}) {
  // Get all function/constant/method symbols from the code repo
  const symbols = db
    .prepare(`
    SELECT id, name, kind, file_path FROM code_symbols
    WHERE repo_id = ? AND kind IN ('function', 'constant', 'method')
  `)
    .all(repoId);

  // Get all doc section titles + content for matching
  const sections = db
    .prepare(`
    SELECT id, title, content, role FROM doc_sections WHERE repo_id = ?
  `)
    .all(docRepoId);

  // Build lookup: lowercase name → section match
  const docNames = new Map();
  for (const s of sections) {
    const lowerTitle = s.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    docNames.set(lowerTitle, s);
    // Also extract function-like references from content (e.g., `search(query)`)
    const fnRefs = s.content.match(/\b([a-z_][a-z0-9_]{2,})\s*\(/gi) || [];
    for (const ref of fnRefs) {
      const name = ref.replace(/\s*\($/, '').toLowerCase();
      if (!docNames.has(name)) {docNames.set(name, s);}
    }
  }

  let documented = 0;
  const documented_list = [];
  const undocumented_list = [];

  for (const sym of symbols) {
    const lowerName = sym.name.toLowerCase();
    const matched = docNames.has(lowerName) || docNames.has(lowerName.replace(/_/g, ''));
    if (matched) {
      documented++;
      documented_list.push(sym);
    } else {
      undocumented_list.push(sym);
    }
  }

  const total = symbols.length;
  const coveragePct = total > 0 ? Math.round((documented / total) * 100) : 0;

  return {
    total_symbols: total,
    documented,
    undocumented: undocumented_list.length,
    coverage_pct: coveragePct,
    documented_list: documented_list.slice(0, RESULT_LIMITS.DOC_COVERAGE_LIST_LIMIT),
    undocumented_list: undocumented_list.slice(0, RESULT_LIMITS.DOC_COVERAGE_LIST_LIMIT),
  };
}

// ══════════════════════════════════════════════════════════
// STALE PAGE DETECTION (files modified since last index)
// ══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════
// DUPLICATE SECTION DETECTION (content-hash matching)
// ══════════════════════════════════════════════════════════

function getDuplicateSections(db, repoId) {
  // Find sections with identical content_hash
  const duplicates = db
    .prepare(`
    SELECT
      content_hash,
      COUNT(*) as count,
      GROUP_CONCAT(id) as section_ids,
      GROUP_CONCAT(title, '|||') as titles,
      GROUP_CONCAT(file_id) as file_ids
    FROM doc_sections
    WHERE repo_id = ? AND content_hash != '' AND content IS NOT NULL
    GROUP BY content_hash
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `)
    .all(repoId);

  // Enrich with file paths
  const results = [];
  for (const dup of duplicates) {
    const ids = dup.section_ids.split(',').map(Number);
    const titles = dup.titles.split('|||');
    const fileIds = dup.file_ids.split(',').map(Number);

    const sections = [];
    for (let i = 0; i < ids.length; i++) {
      const fileId = fileIds[i] || fileIds[0];
      const fileRow = db.prepare('SELECT path FROM doc_files WHERE id = ?').get(fileId);
      sections.push({
        id: ids[i],
        title: titles[i] || '',
        file_path: fileRow ? fileRow.path : '',
      });
    }

    results.push({
      content_hash: dup.content_hash,
      count: dup.count,
      sections,
    });
  }

  return { duplicates: results, total_duplicate_groups: results.length };
}

function getStalePages(db, repoId) {

  const repo = db.prepare('SELECT path FROM doc_repos WHERE id = ?').get(repoId);
  if (!repo) {return { error: 'Repo not found' };}

  const files = db.prepare('SELECT id, path, mtime, content_hash FROM doc_files WHERE repo_id = ?').all(repoId);
  const stale = [];
  const missing = [];

  for (const file of files) {
    const fullPath = path.join(repo.path, file.path);
    try {
      const stat = fs.statSync(fullPath);
      if (file.mtime && stat.mtimeMs > file.mtime) {
        stale.push({
          id: file.id,
          path: file.path,
          indexed_mtime: file.mtime,
          current_mtime: stat.mtimeMs,
          reason: 'modified',
        });
      }
    } catch (e) {
      missing.push({
        id: file.id,
        path: file.path,
        reason: 'missing',
      });
    }
  }

  return { stale, missing, total_files: files.length };
}

module.exports = {
  indexDocs: _withDb(indexDocs),
  reindexDocs: _withDb(reindexDocs),
  searchDocs: _withDb(searchDocs),
  getDocOutline: _withDb(getDocOutline),
  getBacklinks: _withDb(getBacklinks),
  getBrokenLinks: _withDb(getBrokenLinks),
  lookupTerm: _withDb(lookupTerm),
  getTutorialPath: _withDb(getTutorialPath),
  findCodeExamples: _withDb(findCodeExamples),
  resolveLinks: _withDb(resolveLinks),
  getOrphanSections: _withDb(getOrphanSections),
  getDocCoverage: _withDb(getDocCoverage),
  getStalePages: _withDb(getStalePages),
  getDuplicateSections: _withDb(getDuplicateSections),
  _parseMarkdownSections: parseMarkdownSections,
  _slugify: slugify,
};
