use crosshash_core::EntityVersion;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChangeKind {
    Unchanged,
    BodyOnly,
    SignatureChanged,
    Renamed,
    Moved,
    Deleted,
    Added,
    Modified,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChangedEntity {
    pub entity_id: Uuid,
    pub old_name: Option<String>,
    pub new_name: Option<String>,
    pub change_kind: ChangeKind,
    pub diff_summary: String,
}

pub fn diff_entities(
    old_versions: &[EntityVersion],
    new_versions: &[EntityVersion],
) -> Vec<ChangedEntity> {
    let old = old_versions
        .iter()
        .map(|v| (v.entity_id, v))
        .collect::<HashMap<_, _>>();
    let new = new_versions
        .iter()
        .map(|v| (v.entity_id, v))
        .collect::<HashMap<_, _>>();
    let mut ids = old
        .keys()
        .copied()
        .collect::<std::collections::BTreeSet<_>>();
    ids.extend(new.keys().copied());
    ids.into_iter()
        .filter_map(|id| match (old.get(&id), new.get(&id)) {
            (Some(o), Some(n)) => classify_pair(o, n).map(|kind| ChangedEntity {
                entity_id: id,
                old_name: Some(o.name.clone()),
                new_name: Some(n.name.clone()),
                change_kind: kind,
                diff_summary: summary(kind, o, n),
            }),
            (Some(o), None) => Some(ChangedEntity {
                entity_id: id,
                old_name: Some(o.name.clone()),
                new_name: None,
                change_kind: ChangeKind::Deleted,
                diff_summary: "entity deleted".into(),
            }),
            (None, Some(n)) => Some(ChangedEntity {
                entity_id: id,
                old_name: None,
                new_name: Some(n.name.clone()),
                change_kind: ChangeKind::Added,
                diff_summary: "entity added".into(),
            }),
            (None, None) => None,
        })
        .collect()
}

fn classify_pair(o: &EntityVersion, n: &EntityVersion) -> Option<ChangeKind> {
    if o.signature_hash == n.signature_hash
        && o.content_hash == n.content_hash
        && o.structural_hash == n.structural_hash
        && o.identity_hash == n.identity_hash
        && o.context_hash == n.context_hash
    {
        return None;
    }
    if o.identity_hash == n.identity_hash && o.name != n.name {
        return Some(ChangeKind::Renamed);
    }
    if o.context_hash != n.context_hash && o.content_hash == n.content_hash {
        return Some(ChangeKind::Moved);
    }
    if o.signature_hash != n.signature_hash {
        return Some(ChangeKind::SignatureChanged);
    }
    if o.content_hash != n.content_hash && o.structural_hash == n.structural_hash {
        return Some(ChangeKind::BodyOnly);
    }
    if o.structural_hash != n.structural_hash && o.content_hash != n.content_hash {
        return Some(ChangeKind::Modified);
    }
    Some(ChangeKind::Modified)
}

fn summary(kind: ChangeKind, o: &EntityVersion, n: &EntityVersion) -> String {
    match kind {
        ChangeKind::SignatureChanged => format!(
            "signature_hash changed: '{}' -> '{}'",
            o.signature, n.signature
        ),
        ChangeKind::BodyOnly => "content_hash changed while signature_hash stayed the same".into(),
        ChangeKind::Renamed => format!(
            "identity_hash same, name changed: '{}' -> '{}'",
            o.name, n.name
        ),
        ChangeKind::Moved => "context_hash changed while content_hash stayed the same".into(),
        _ => format!("{kind:?}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    fn v(id: Uuid) -> EntityVersion {
        EntityVersion {
            entity_id: id,
            commit_hash: "a".into(),
            name: "f".into(),
            qualified_name: "f".into(),
            signature: "fn f()".into(),
            signature_hash: [1; 32],
            content_hash: [2; 32],
            structural_hash: [3; 32],
            identity_hash: [4; 32],
            context_hash: [5; 32],
            snapshot_at: Utc::now(),
        }
    }
    #[test]
    fn classifies_body_only_and_signature_change() {
        let id = Uuid::now_v7();
        let old = v(id);
        let mut new = v(id);
        new.content_hash = [9; 32];
        assert_eq!(
            diff_entities(std::slice::from_ref(&old), &[new])
                .pop()
                .unwrap()
                .change_kind,
            ChangeKind::BodyOnly
        );
        let mut new = v(id);
        new.signature_hash = [9; 32];
        assert_eq!(
            diff_entities(&[old], &[new]).pop().unwrap().change_kind,
            ChangeKind::SignatureChanged
        );
    }
}
