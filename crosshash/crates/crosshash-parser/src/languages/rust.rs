use crate::entity_extractor::EntityExtractor;
use crosshash_core::{Entity, EntityKind, Language, Result, Visibility};
use crosshash_hash::{EntityHasher, HashInput};
use std::path::Path;
use tree_sitter::{Node, Tree};
use uuid::Uuid;

#[derive(Debug, Default)]
pub struct RustExtractor;

impl EntityExtractor for RustExtractor {
    fn extract_entities(
        &self,
        repo_id: Uuid,
        repo_root: &Path,
        file_path: &Path,
        source: &str,
        tree: &Tree,
        commit_hash: &str,
    ) -> Result<Vec<Entity>> {
        Ok(extract_rust_entities(
            repo_id,
            repo_root,
            file_path,
            source,
            tree,
            commit_hash,
        ))
    }
}

pub fn extract_rust_entities(
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
    let mut entities = Vec::new();
    walk_node(
        repo_id,
        &relative_path,
        source,
        tree.root_node(),
        commit_hash,
        &mut Vec::new(),
        &mut entities,
    );
    entities
}

fn walk_node(
    repo_id: Uuid,
    file_path: &str,
    source: &str,
    node: Node,
    commit_hash: &str,
    parents: &mut Vec<String>,
    entities: &mut Vec<Entity>,
) {
    if let Some((kind, name, signature, visibility)) = entity_from_node(source, node) {
        let qualified_name = if parents.is_empty() {
            name.clone()
        } else {
            format!("{}::{}", parents.join("::"), name)
        };
        let body = node_text(source, node).to_string();
        let hashes = EntityHasher::compute(&HashInput {
            kind,
            signature: signature.clone(),
            body,
            structural_repr: structural_repr(node),
            identity_repr: identity_repr(source, node),
            parent_structural_hash: None,
            depth: parents.len() as u32,
        });
        entities.push(Entity {
            id: Uuid::new_v5(
                &repo_id,
                format!("{file_path}:{kind:?}:{qualified_name}").as_bytes(),
            ),
            repo_id,
            file_path: file_path.to_string(),
            language: Language::Rust,
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
            is_async: node_text(source, node).contains("async fn"),
            is_test: node_text(source, node).contains("#[test]"),
            first_seen_commit: commit_hash.to_string(),
            last_seen_commit: commit_hash.to_string(),
            deleted_at_commit: None,
        });
        parents.push(name);
        walk_children(
            repo_id,
            file_path,
            source,
            node,
            commit_hash,
            parents,
            entities,
        );
        parents.pop();
    } else {
        walk_children(
            repo_id,
            file_path,
            source,
            node,
            commit_hash,
            parents,
            entities,
        );
    }
}

fn walk_children(
    repo_id: Uuid,
    file_path: &str,
    source: &str,
    node: Node,
    commit_hash: &str,
    parents: &mut Vec<String>,
    entities: &mut Vec<Entity>,
) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        walk_node(
            repo_id,
            file_path,
            source,
            child,
            commit_hash,
            parents,
            entities,
        );
    }
}

fn entity_from_node(source: &str, node: Node) -> Option<(EntityKind, String, String, Visibility)> {
    let kind = match node.kind() {
        "function_item" => EntityKind::Function,
        "struct_item" => EntityKind::Struct,
        "enum_item" => EntityKind::Enum,
        "trait_item" => EntityKind::Trait,
        "impl_item" => EntityKind::Impl,
        "mod_item" => EntityKind::Module,
        "const_item" => EntityKind::Constant,
        _ => return None,
    };
    let name = node
        .child_by_field_name("name")
        .map(|n| node_text(source, n).to_string())
        .unwrap_or_else(|| format!("anonymous_{}", node.start_byte()));
    let text = node_text(source, node).trim_start();
    let visibility = if text.starts_with("pub(crate)") {
        Visibility::Crate
    } else if text.starts_with("pub") {
        Visibility::Public
    } else {
        Visibility::Private
    };
    Some((kind, name, signature_text(source, node), visibility))
}

fn signature_text(source: &str, node: Node) -> String {
    let text = node_text(source, node);
    text.find('{')
        .map(|idx| text[..idx].trim().to_string())
        .unwrap_or_else(|| text.lines().next().unwrap_or(text).trim().to_string())
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::parse_source;
    #[test]
    fn extracts_rust_entities_with_hashes() {
        let source = "pub struct User { id: u64 }\nimpl User { pub fn new() -> Self { Self { id: 1 } } }\nfn helper() {}";
        let tree = parse_source(source, Language::Rust).unwrap();
        let repo = Uuid::now_v7();
        let entities = extract_rust_entities(
            repo,
            Path::new("."),
            Path::new("src/lib.rs"),
            source,
            &tree,
            "abc",
        );
        assert!(entities
            .iter()
            .any(|e| e.name == "User" && e.kind == EntityKind::Struct));
        assert!(entities
            .iter()
            .any(|e| e.name == "helper" && e.kind == EntityKind::Function));
        assert!(entities.iter().all(|e| e.content_hash != [0; 32]));
    }
}
