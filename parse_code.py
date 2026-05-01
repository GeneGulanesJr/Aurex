#!/usr/bin/env python3
"""
parse_code.py — tree-sitter AST parser, called as subprocess from memory-store.js.

Usage: python3 parse_code.py <file_path>
Output: JSON array of symbol objects to stdout.

Supported: .js, .mjs, .cjs, .ts, .mts, .cts, .tsx (JS/TS), .sql
"""

import json
import sys
from pathlib import Path


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing file path argument"}))
        sys.exit(1)

    file_path = sys.argv[1]
    ext = Path(file_path).suffix.lower()

    # Map extension to language
    language_map = {
        '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
        '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
        '.tsx': 'typescript',
        '.sql': 'sql',
    }

    lang = language_map.get(ext)
    if not lang:
        print(json.dumps({"error": f"Unsupported file type: {ext}"}))
        sys.exit(1)

    try:
        with open(file_path, 'rb') as f:
            source = f.read()
    except FileNotFoundError:
        print(json.dumps({"error": f"File not found: {file_path}"}))
        sys.exit(1)
    except PermissionError:
        print(json.dumps({"error": f"Permission denied: {file_path}"}))
        sys.exit(1)

    symbols = parse_file(file_path, source, lang)
    print(json.dumps(symbols))


def parse_file(file_path: str, source: bytes, language_name: str) -> list[dict]:
    """Parse a file and return symbols as plain dicts."""
    if language_name in ("typescript", "javascript"):
        return _extract_js_ts_symbols(file_path, source, language_name)
    elif language_name == "sql":
        return _extract_sql_symbols(file_path, source)
    return []


# ── tree-sitter imports ──
try:
    from tree_sitter import Language as _TSLang, Parser as _TSParser

    _PARSERS = {}

    # JavaScript
    try:
        import tree_sitter_javascript
        _PARSERS['javascript'] = _TSParser()
        _PARSERS['javascript'].language = _TSLang(tree_sitter_javascript.language())
    except (ImportError, Exception):
        pass

    # TypeScript
    try:
        import tree_sitter_typescript
        _PARSERS['typescript'] = _TSParser()
        _PARSERS['typescript'].language = _TSLang(tree_sitter_typescript.language_typescript())
    except (ImportError, Exception):
        if 'javascript' in _PARSERS:
            _PARSERS['typescript'] = _PARSERS['javascript']

    # SQL
    try:
        import tree_sitter_sql
        _PARSERS['sql'] = _TSParser()
        _PARSERS['sql'].language = _TSLang(tree_sitter_sql.language())
    except (ImportError, Exception):
        pass

    _PARSER_READY = bool(_PARSERS)

except ImportError:
    _PARSER_READY = False
    _PARSERS = {}


# ── JS/TS symbol extraction ──

_JS_TS_SYMBOL_NODES = {
    "function_declaration": "function",
    "generator_function_declaration": "function",
    "class_declaration": "class",
    "method_definition": "method",
    "interface_declaration": "interface",
    "type_alias_declaration": "type",
    "enum_declaration": "enum",
}

_VARIABLE_FUNCTION_NODES = {"arrow_function", "function_expression"}


def _get_node_name(node):
    for child in node.children:
        if child.type in ("identifier", "type_identifier", "property_identifier"):
            return child.text.decode("utf-8")
    return None


def _get_parent_class_name(node):
    parent = node.parent
    while parent:
        if parent.type == "class_declaration":
            for child in parent.children:
                if child.type in ("identifier", "type_identifier"):
                    return child.text.decode("utf-8")
        parent = parent.parent
    return ""


def _get_signature(node, source):
    text = source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
    first_line = text.split("\n")[0].strip()
    if len(first_line) > 200:
        first_line = first_line[:197] + "..."
    return first_line


def _get_docstring(node, source):
    if node.parent is None:
        return ""
    siblings = list(node.parent.children)
    idx = siblings.index(node)
    if idx > 0:
        prev = siblings[idx - 1]
        if prev.type == "comment":
            text = prev.text.decode("utf-8", errors="replace").strip()
            if text.startswith("/**"):
                text = text[3:]
            elif text.startswith("/*"):
                text = text[2:]
            if text.endswith("*/"):
                text = text[:-2]
            lines = text.split("\n")
            cleaned = []
            for line in lines:
                line = line.strip()
                if line.startswith("* "):
                    line = line[2:]
                elif line == "*":
                    line = ""
                cleaned.append(line.strip())
            return "\n".join(cleaned).strip()
    return ""


def _get_body_preview(node, source, max_lines=5):
    text = source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
    lines = text.split("\n")
    body_lines = []
    for line in lines[1:]:
        stripped = line.strip()
        if stripped:
            body_lines.append(stripped)
            if len(body_lines) >= max_lines:
                break
    return "\n".join(body_lines)


def _get_line_number(node, source):
    return source[:node.start_byte].count(b"\n") + 1


def _get_end_line_number(node, source):
    return source[:node.end_byte].count(b"\n") + 1


def _extract_js_ts_symbols(file_path, source, language_name):
    parser = _PARSERS.get(language_name)
    if parser is None:
        return []

    tree = parser.parse(source)
    root = tree.root_node
    symbols = []
    seen = set()

    def walk(node):
        nonlocal symbols
        if node.type in _JS_TS_SYMBOL_NODES:
            kind = _JS_TS_SYMBOL_NODES[node.type]
            name = _get_node_name(node)
            if name:
                key = (name, kind, node.start_byte)
                if key not in seen:
                    seen.add(key)
                    parent_name = _get_parent_class_name(node) if kind == "method" else ""
                    qualified = f"{parent_name}.{name}" if parent_name else name
                    symbols.append({
                        "name": name,
                        "kind": kind,
                        "language": language_name,
                        "file": file_path,
                        "signature": _get_signature(node, source),
                        "qualified_name": qualified,
                        "start_line": _get_line_number(node, source),
                        "end_line": _get_end_line_number(node, source),
                        "start_byte": node.start_byte,
                        "end_byte": node.end_byte,
                        "docstring": _get_docstring(node, source),
                        "body_preview": _get_body_preview(node, source),
                        "parent_name": parent_name,
                    })
        elif node.type in _VARIABLE_FUNCTION_NODES:
            parent = node.parent
            if parent and parent.type == "variable_declarator":
                name = None
                for child in parent.children:
                    if child.type == "identifier":
                        name = child.text.decode("utf-8")
                        break
                if name:
                    key = (name, "function", node.start_byte)
                    if key not in seen:
                        seen.add(key)
                        parent_name = _get_parent_class_name(node)
                        qualified = f"{parent_name}.{name}" if parent_name else name
                        symbols.append({
                            "name": name,
                            "kind": "function",
                            "language": language_name,
                            "file": file_path,
                            "signature": _get_signature(parent, source),
                            "qualified_name": qualified,
                            "start_line": _get_line_number(parent, source),
                            "end_line": _get_end_line_number(parent, source),
                            "start_byte": parent.start_byte,
                            "end_byte": parent.end_byte,
                            "docstring": _get_docstring(parent, source),
                            "body_preview": _get_body_preview(node, source),
                            "parent_name": parent_name,
                        })
        for child in node.children:
            if child.type == "statement_block":
                continue
            walk(child)

    walk(root)
    return symbols


def _extract_sql_symbols(file_path, source):
    parser = _PARSERS.get('sql')
    if parser is None:
        return []

    tree = parser.parse(source)
    root = tree.root_node
    symbols = []

    def get_text(node):
        return node.text.decode("utf-8", errors="replace")

    def get_name(node):
        for child in node.children:
            if child.type == "object_reference":
                return get_text(child)
            if child.type == "identifier":
                return get_text(child)
        return ""

    SQL_STATEMENT_MAP = {
        "create_table": "table",
        "create_view": "view",
        "create_index": "index",
        "select": "query",
        "insert": "query",
        "update": "query",
        "delete": "query",
        "alter_table": "table",
    }

    def walk(node):
        nonlocal symbols
        if node.type in SQL_STATEMENT_MAP:
            kind = SQL_STATEMENT_MAP[node.type]
            name = get_name(node)
            if not name:
                name = {"select": "SELECT", "insert": "INSERT",
                        "update": "UPDATE", "delete": "DELETE"}.get(node.type, "UNKNOWN")

            sig = get_text(node).split("\n")[0].strip()
            if len(sig) > 200:
                sig = sig[:197] + "..."

            body_lines = [l.strip() for l in get_text(node).split("\n")[1:] if l.strip()][:5]
            body_preview = "\n".join(body_lines)

            start_line = source[:node.start_byte].count(b"\n") + 1
            end_line = source[:node.end_byte].count(b"\n") + 1

            symbols.append({
                "name": name,
                "kind": kind,
                "language": "sql",
                "file": file_path,
                "signature": sig,
                "qualified_name": name,
                "start_line": start_line,
                "end_line": end_line,
                "start_byte": node.start_byte,
                "end_byte": node.end_byte,
                "docstring": "",
                "body_preview": body_preview,
                "parent_name": "",
            })
        for child in node.children:
            walk(child)

    walk(root)
    return symbols


if __name__ == "__main__":
    main()
