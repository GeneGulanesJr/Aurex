use crate::entity_extractor::EntityExtractor;
use crosshash_core::{Entity, EntityKind, Language, Result, Visibility};
use crosshash_hash::{EntityHasher, HashInput};
use std::path::Path;
use tree_sitter::{Node, Tree};
use uuid::Uuid;

#[derive(Debug, Default)]
pub struct GoExtractor;

impl EntityExtractor for GoExtractor {
    fn extract_entities(
        &self,
        repo_id: Uuid,
        repo_root: &Path,
        file_path: &Path,
        source: &str,
        tree: &Tree,
        commit_hash: &str,
    ) -> Result<Vec<Entity>> {
        Ok(extract_go_entities(
            repo_id,
            repo_root,
            file_path,
            source,
            tree,
            commit_hash,
        ))
    }
}

pub fn extract_go_entities(
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
        &mut Vec::new(),
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
    parents: &mut Vec<String>,
    out: &mut Vec<Entity>,
) {
    if let Some((kind, name, visibility)) = entity_from_node(source, node) {
        let qualified_name = if parents.is_empty() {
            name.clone()
        } else {
            format!("{}.{}", parents.join("."), name)
        };
        let body = node_text(source, node).to_string();
        let signature = signature_text(&body);
        let hashes = EntityHasher::compute(&HashInput {
            kind,
            signature: signature.clone(),
            body: body.clone(),
            structural_repr: structural_repr(node),
            identity_repr: identity_repr(source, node),
            parent_structural_hash: None,
            depth: parents.len() as u32,
        });
        out.push(Entity {
            id: Uuid::new_v5(
                &repo_id,
                format!("{file_path}:{kind:?}:{qualified_name}").as_bytes(),
            ),
            repo_id,
            file_path: file_path.to_string(),
            language: Language::Go,
            kind,
            name: name.clone(),
            qualified_name,
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
            visibility,
            is_exported: visibility == Visibility::Public,
            is_async: false,
            is_test: name.starts_with("Test") || name.starts_with("Benchmark"),
            first_seen_commit: commit_hash.to_string(),
            last_seen_commit: commit_hash.to_string(),
            deleted_at_commit: None,
        });
        parents.push(name);
        walk_children(repo_id, file_path, source, node, commit_hash, parents, out);
        parents.pop();
    } else {
        walk_children(repo_id, file_path, source, node, commit_hash, parents, out);
    }
}

fn walk_children(
    repo_id: Uuid,
    file_path: &str,
    source: &str,
    node: Node,
    commit_hash: &str,
    parents: &mut Vec<String>,
    out: &mut Vec<Entity>,
) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        walk(repo_id, file_path, source, child, commit_hash, parents, out);
    }
}

fn entity_from_node(source: &str, node: Node) -> Option<(EntityKind, String, Visibility)> {
    let kind = match node.kind() {
        "function_declaration" | "method_spec" | "method_elem" => EntityKind::Function,
        "type_declaration" => {
            let text = node_text(source, node);
            if text.starts_with("type ") {
                let after_type = text.strip_prefix("type ")?;
                if after_type.contains("struct") {
                    return Some((EntityKind::Struct, extract_name(source, node)?, Visibility::Public));
                } else if after_type.contains("interface") {
                    return Some((EntityKind::Interface, extract_name(source, node)?, Visibility::Public));
                }
            }
            return None;
        }
        _ => return None,
    };
    let name = extract_name(source, node)?;
    let visibility = if name.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
        Visibility::Public
    } else {
        Visibility::Private
    };
    Some((kind, name, visibility))
}

fn extract_name(source: &str, node: Node) -> Option<String> {
    node.child_by_field_name("name")
        .map(|n| node_text(source, n).to_string())
}

fn signature_text(body: &str) -> String {
    body.find('{')
        .map(|idx| body[..idx].trim().to_string())
        .unwrap_or_else(|| body.lines().next().unwrap_or(body).trim().to_string())
}

fn structural_repr(node: Node) -> String {
    let mut parts = vec![node.kind().to_string()];
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        parts.push(child.kind().to_string());
    }
    parts.join(" ")
}

fn identity_repr(source: &str, node: Node) -> String {
    let mut repr = structural_repr(node);
    if let Some(name) = node.child_by_field_name("name") {
        repr.push_str(&format!(" name:{}", node_text(source, name).len()));
    }
    repr
}

fn node_text<'a>(source: &'a str, node: Node<'a>) -> &'a str {
    &source[node.start_byte()..node.end_byte()]
}