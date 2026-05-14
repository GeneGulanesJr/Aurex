use crosshash_core::{Entity, EntityKind, Language};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SurfaceKind {
    HttpEndpoint,
    GrpcService,
    MessageTopic,
    LibraryApi,
    FrameworkRoute,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicEntitySurface {
    pub entity_id: Uuid,
    pub repo_id: Uuid,
    pub language: Language,
    pub kind: SurfaceKind,
    pub name: String,
    pub qualified_name: String,
    pub signature: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApiSurface {
    pub repo_id: Uuid,
    pub entities: Vec<PublicEntitySurface>,
}

impl ApiSurface {
    pub fn from_exported_entities(
        repo_id: Uuid,
        entities: impl IntoIterator<Item = Entity>,
    ) -> Self {
        let mut items = entities
            .into_iter()
            .filter(|e| e.is_exported)
            .map(|e| PublicEntitySurface {
                entity_id: e.id,
                repo_id: e.repo_id,
                language: e.language,
                kind: classify_surface(&e),
                name: e.name,
                qualified_name: e.qualified_name,
                signature: e.signature,
            })
            .collect::<Vec<_>>();
        items.sort_by(|a, b| a.qualified_name.cmp(&b.qualified_name));
        Self {
            repo_id,
            entities: items,
        }
    }

    pub fn to_prompt_json(&self) -> serde_json::Value {
        serde_json::json!({"repo_id": self.repo_id, "public_api": self.entities})
    }
}

fn classify_surface(entity: &Entity) -> SurfaceKind {
    let s = entity.signature.to_ascii_lowercase();
    if s.contains("get ") || s.contains("post ") || s.contains("route") {
        SurfaceKind::HttpEndpoint
    } else if s.contains("grpc") || s.contains("service") {
        SurfaceKind::GrpcService
    } else if s.contains("topic") || s.contains("event") {
        SurfaceKind::MessageTopic
    } else if matches!(
        entity.kind,
        EntityKind::Function
            | EntityKind::Method
            | EntityKind::Struct
            | EntityKind::Trait
            | EntityKind::Class
            | EntityKind::Interface
    ) {
        SurfaceKind::LibraryApi
    } else {
        SurfaceKind::FrameworkRoute
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crosshash_core::{Entity, EntityKind, Language, Visibility};

    fn make_exported_entity(name: &str, sig: &str, kind: EntityKind) -> Entity {
        Entity {
            id: Uuid::now_v7(),
            repo_id: Uuid::now_v7(),
            file_path: "src/lib.rs".into(),
            language: Language::Rust,
            kind,
            name: name.into(),
            qualified_name: format!("myapp::{name}"),
            signature: sig.into(),
            start_line: 1,
            end_line: 3,
            start_byte: 0,
            end_byte: 30,
            signature_hash: [1u8; 32],
            content_hash: [2u8; 32],
            structural_hash: [3u8; 32],
            identity_hash: [4u8; 32],
            context_hash: [5u8; 32],
            visibility: Visibility::Public,
            is_exported: true,
            is_async: false,
            is_test: false,
            first_seen_commit: "abc".into(),
            last_seen_commit: "abc".into(),
            deleted_at_commit: None,
        }
    }

    #[test]
    fn filters_to_exported_entities_only() {
        let repo_id = Uuid::now_v7();
        let mut e = make_exported_entity("pub_fn", "pub fn pub_fn()", EntityKind::Function);
        e.is_exported = false;
        let surface = ApiSurface::from_exported_entities(repo_id, vec![e]);
        assert!(surface.entities.is_empty());
    }

    #[test]
    fn classifies_http_endpoint() {
        let e = make_exported_entity("get_users", "get /users", EntityKind::Function);
        let repo_id = e.repo_id;
        let surface = ApiSurface::from_exported_entities(repo_id, vec![e]);
        assert_eq!(surface.entities[0].kind, SurfaceKind::HttpEndpoint);
    }

    #[test]
    fn classifies_grpc_service() {
        let e = make_exported_entity(
            "UserService",
            "grpc service UserService",
            EntityKind::Struct,
        );
        let repo_id = e.repo_id;
        let surface = ApiSurface::from_exported_entities(repo_id, vec![e]);
        assert_eq!(surface.entities[0].kind, SurfaceKind::GrpcService);
    }

    #[test]
    fn classifies_message_topic() {
        let e = make_exported_entity("user_events", "topic user_events", EntityKind::Function);
        let repo_id = e.repo_id;
        let surface = ApiSurface::from_exported_entities(repo_id, vec![e]);
        assert_eq!(surface.entities[0].kind, SurfaceKind::MessageTopic);
    }

    #[test]
    fn classifies_library_api_for_function() {
        let e = make_exported_entity(
            "calculate",
            "fn calculate(x: i32) -> i32",
            EntityKind::Function,
        );
        let repo_id = e.repo_id;
        let surface = ApiSurface::from_exported_entities(repo_id, vec![e]);
        assert_eq!(surface.entities[0].kind, SurfaceKind::LibraryApi);
    }

    #[test]
    fn to_prompt_json_includes_repo_and_entities() {
        let e = make_exported_entity("my_fn", "fn my_fn()", EntityKind::Function);
        let repo_id = e.repo_id;
        let surface = ApiSurface::from_exported_entities(repo_id, vec![e]);
        let json = surface.to_prompt_json();
        assert_eq!(json["repo_id"], repo_id.to_string());
        assert!(json["public_api"].as_array().unwrap().len() == 1);
    }

    #[test]
    fn sorts_entities_by_qualified_name() {
        let e1 = make_exported_entity("beta", "fn beta()", EntityKind::Function);
        let e2 = make_exported_entity("alpha", "fn alpha()", EntityKind::Function);
        let repo_id = e1.repo_id;
        let surface = ApiSurface::from_exported_entities(repo_id, vec![e1, e2]);
        assert_eq!(surface.entities[0].name, "alpha");
        assert_eq!(surface.entities[1].name, "beta");
    }
}
