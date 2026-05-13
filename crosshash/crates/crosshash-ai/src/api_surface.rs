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
