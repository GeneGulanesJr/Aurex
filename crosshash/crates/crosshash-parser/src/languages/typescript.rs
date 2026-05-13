use crate::entity_extractor::EntityExtractor;
use crosshash_core::{Entity, EntityKind, Language, Result, Visibility};
use crosshash_hash::{EntityHasher, HashInput};
use std::path::Path;
use tree_sitter::{Node, Tree};
use uuid::Uuid;

#[derive(Debug, Default)]
pub struct TypeScriptExtractor;

impl EntityExtractor for TypeScriptExtractor {
    fn extract_entities(
        &self,
        repo_id: Uuid,
        repo_root: &Path,
        file_path: &Path,
        source: &str,
        tree: &Tree,
        commit_hash: &str,
    ) -> Result<Vec<Entity>> {
        Ok(extract_typescript_entities(
            repo_id,
            repo_root,
            file_path,
            source,
            tree,
            commit_hash,
        ))
    }
}

pub fn extract_typescript_entities(
    repo_id: Uuid,
    repo_root: &Path,
    file_path: &Path,
    source: &str,
    tree: &Tree,
    commit_hash: &str,
) -> Vec<Entity> {
    let relative_path = file_path
        .strip_prefix(repo_root)
        .unwrap_or(file_path)
        .to_string_lossy()
        .to_string();
    let mut out = Vec::new();
    walk(
        repo_id,
        &relative_path,
        source,
        tree.root_node(),
        commit_hash,
        &mut out,
    );
    out
}

fn walk(
    repo_id: Uuid,
    file_path: &str,
    source: &str,
    node: Node,
    commit_hash: &str,
    out: &mut Vec<Entity>,
) {
    if let Some((kind, name)) = entity_name(source, node) {
        let body = node_text(source, node).to_string();
        let signature = signature_text(&body);
        let is_exported = body.trim_start().starts_with("export") || parent_export(source, node);
        let hashes = EntityHasher::compute(&HashInput {
            kind,
            signature: signature.clone(),
            body: body.clone(),
            structural_repr: node.kind().to_string(),
            identity_repr: format!("{} _", node.kind()),
            parent_structural_hash: None,
            depth: 0,
        });
        out.push(Entity {
            id: Uuid::new_v5(&repo_id, format!("{file_path}:{kind:?}:{name}").as_bytes()),
            repo_id,
            file_path: file_path.into(),
            language: Language::TypeScript,
            kind,
            name: name.clone(),
            qualified_name: name,
            signature,
            start_line: node.start_position().row as u32 + 1,
            end_line: node.end_position().row as u32 + 1,
            start_byte: node.start_byte() as u32,
            end_byte: node.end_byte() as u32,
            signature_hash: hashes.signature_hash,
            content_hash: hashes.content_hash,
            structural_hash: hashes.structural_hash,
            identity_hash: hashes.identity_hash,
            context_hash: hashes.context_hash,
            visibility: if is_exported {
                Visibility::Public
            } else {
                Visibility::Private
            },
            is_exported,
            is_async: body.contains("async "),
            is_test: body.contains("test(") || body.contains("it("),
            first_seen_commit: commit_hash.into(),
            last_seen_commit: commit_hash.into(),
            deleted_at_commit: None,
        });
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        walk(repo_id, file_path, source, child, commit_hash, out);
    }
}

fn entity_name(source: &str, node: Node) -> Option<(EntityKind, String)> {
    let kind = match node.kind() {
        "function_declaration" | "method_definition" => EntityKind::Function,
        "class_declaration" => EntityKind::Class,
        "interface_declaration" => EntityKind::Interface,
        "type_alias_declaration" => EntityKind::TypeAlias,
        "lexical_declaration" | "variable_declarator" => EntityKind::Function,
        _ => return None,
    };
    node.child_by_field_name("name")
        .map(|n| (kind, node_text(source, n).to_string()))
}
fn signature_text(body: &str) -> String {
    body.find('{')
        .or_else(|| body.find('='))
        .map(|idx| body[..idx].trim().to_string())
        .unwrap_or_else(|| body.lines().next().unwrap_or(body).trim().to_string())
}
fn parent_export(source: &str, node: Node) -> bool {
    node.parent()
        .map(|p| {
            p.kind() == "export_statement"
                && node_text(source, p).trim_start().starts_with("export")
        })
        .unwrap_or(false)
}
fn node_text<'a>(source: &'a str, node: Node<'a>) -> &'a str {
    &source[node.start_byte()..node.end_byte()]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::parse_source;
    #[test]
    fn extracts_typescript_entities() {
        let s = "export function f(x: number): number { return x }\ninterface Api { ok: boolean }";
        let t = parse_source(s, Language::TypeScript).unwrap();
        let e = extract_typescript_entities(
            Uuid::now_v7(),
            Path::new("."),
            Path::new("a.ts"),
            s,
            &t,
            "h",
        );
        assert!(e.iter().any(|e| e.name == "f"));
        assert!(e.iter().any(|e| e.name == "Api"));
    }
}
