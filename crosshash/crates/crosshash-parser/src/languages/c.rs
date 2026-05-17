use crate::entity_extractor::EntityExtractor;
use crosshash_core::{Entity, EntityKind, Language, Result, Visibility};
use crosshash_hash::{EntityHasher, HashInput};
use std::path::Path;
use tree_sitter::{Node, Tree};
use uuid::Uuid;

#[derive(Debug, Default)]
pub struct CExtractor;

impl EntityExtractor for CExtractor {
    fn extract_entities(
        &self,
        repo_id: Uuid,
        repo_root: &Path,
        file_path: &Path,
        source: &str,
        tree: &Tree,
        commit_hash: &str,
    ) -> Result<Vec<Entity>> {
        Ok(extract_c_entities(
            repo_id,
            repo_root,
            file_path,
            source,
            tree,
            commit_hash,
        ))
    }
}

macro_rules! define_c_family_extractor {
    ($extract_fn:ident, $lang:expr) => {
        pub fn $extract_fn(
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
                let hashes = EntityHasher::compute(&HashInput {
                    kind,
                    signature: signature.clone(),
                    body: body.clone(),
                    structural_repr: structural_repr(node),
                    identity_repr: identity_repr(source, node),
                    parent_structural_hash: None,
                    depth: 0,
                });
                out.push(Entity {
                    id: Uuid::new_v5(&repo_id, format!("{file_path}:{kind:?}:{name}").as_bytes()),
                    repo_id,
                    file_path: file_path.into(),
                    language: $lang,
                    kind,
                    name: name.clone(),
                    qualified_name: name.clone(),
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
                    visibility: Visibility::Public,
                    is_exported: true,
                    is_async: false,
                    is_test: false,
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
    };
}

define_c_family_extractor!(extract_c_entities, Language::C);

fn entity_name(source: &str, node: Node) -> Option<(EntityKind, String)> {
    let kind = match node.kind() {
        "function_definition" => EntityKind::Function,
        "struct_specifier" => EntityKind::Struct,
        "enum_specifier" => EntityKind::Enum,
        "type_definition" => EntityKind::TypeAlias,
        _ => return None,
    };
    let name = node
        .child_by_field_name("name")
        .or_else(|| {
            // Manual loop required — cursor lifetime is tied to the iterator,
            // so .find() cannot be used (E0597 borrow error).
            let mut cursor = node.walk();
            let mut result = None;
            for child in node.children(&mut cursor) {
                if child.kind() == "identifier" || child.kind() == "type_identifier" {
                    result = Some(child);
                    break;
                }
            }
            result
        })
        .map(|n| node_text(source, n).to_string())
        .unwrap_or_else(|| format!("anonymous_{}", node.start_byte()));
    Some((kind, name))
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
