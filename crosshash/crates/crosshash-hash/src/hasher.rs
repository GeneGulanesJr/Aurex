use crosshash_core::{EntityHashes, EntityKind, Hash32};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HashInput {
    pub kind: EntityKind,
    pub signature: String,
    pub body: String,
    pub structural_repr: String,
    pub identity_repr: String,
    pub parent_structural_hash: Option<Hash32>,
    pub depth: u32,
}

pub type ComputedHashes = EntityHashes;

pub struct EntityHasher;

impl EntityHasher {
    pub fn compute(input: &HashInput) -> ComputedHashes {
        EntityHashes {
            signature_hash: hash_bytes(input.signature.as_bytes()),
            content_hash: hash_bytes(input.body.as_bytes()),
            structural_hash: hash_bytes(input.structural_repr.as_bytes()),
            identity_hash: hash_bytes(input.identity_repr.as_bytes()),
            context_hash: compute_context_hash(input.parent_structural_hash, input.depth),
        }
    }
}

pub fn hash_bytes(bytes: &[u8]) -> Hash32 {
    *blake3::hash(bytes).as_bytes()
}

pub fn hash_file_content(source: &str) -> Hash32 {
    hash_bytes(source.as_bytes())
}

fn compute_context_hash(parent: Option<Hash32>, depth: u32) -> Hash32 {
    let mut hasher = blake3::Hasher::new();
    match parent {
        Some(parent_hash) => hasher.update(&parent_hash),
        None => hasher.update(&[0u8; 32]),
    };
    hasher.update(&depth.to_le_bytes());
    *hasher.finalize().as_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn input(signature: &str, body: &str) -> HashInput {
        HashInput {
            kind: EntityKind::Function,
            signature: signature.to_string(),
            body: body.to_string(),
            structural_repr: "function(parameters block)".to_string(),
            identity_repr: "function(_ _)".to_string(),
            parent_structural_hash: None,
            depth: 0,
        }
    }

    #[test]
    fn identical_code_has_identical_all_five_hashes() {
        let a = EntityHasher::compute(&input("fn a()", "fn a() {}"));
        let b = EntityHasher::compute(&input("fn a()", "fn a() {}"));
        assert_eq!(a, b);
    }

    #[test]
    fn renamed_function_keeps_structural_hash_but_changes_content_hash() {
        let mut a = input("fn a()", "fn a() {}\n");
        let mut b = input("fn b()", "fn b() {}\n");
        a.structural_repr = "function_item parameters block".into();
        b.structural_repr = "function_item parameters block".into();
        a.identity_repr = "function_item fn _ parameters block".into();
        b.identity_repr = "function_item fn _ parameters block".into();

        let a = EntityHasher::compute(&a);
        let b = EntityHasher::compute(&b);
        assert_eq!(a.structural_hash, b.structural_hash);
        assert_eq!(a.identity_hash, b.identity_hash);
        assert_ne!(a.content_hash, b.content_hash);
    }

    #[test]
    fn moved_function_keeps_content_hash_but_changes_context_hash() {
        let mut a = input("fn a()", "fn a() {}");
        let mut b = input("fn a()", "fn a() {}");
        a.parent_structural_hash = Some([1; 32]);
        b.parent_structural_hash = Some([2; 32]);

        let a = EntityHasher::compute(&a);
        let b = EntityHasher::compute(&b);
        assert_eq!(a.content_hash, b.content_hash);
        assert_ne!(a.context_hash, b.context_hash);
    }

    #[test]
    fn signature_change_changes_signature_hash() {
        let a = EntityHasher::compute(&input("fn a() -> u32", "fn a() -> u32 { 1 }"));
        let b = EntityHasher::compute(&input("fn a(x: u32) -> u32", "fn a(x: u32) -> u32 { x }"));
        assert_ne!(a.signature_hash, b.signature_hash);
    }

    #[test]
    fn reformatted_code_keeps_identity_hash() {
        let mut a = input("fn a()->u32", "fn a()->u32{1}");
        let mut b = input("fn a() -> u32", "fn a() -> u32 {\n    1\n}");
        a.identity_repr = "function_item fn _ parameters primitive_type block".into();
        b.identity_repr = a.identity_repr.clone();

        let a = EntityHasher::compute(&a);
        let b = EntityHasher::compute(&b);
        assert_eq!(a.identity_hash, b.identity_hash);
    }

    proptest! {
        #[test]
        fn hash_bytes_is_deterministic(data in proptest::collection::vec(any::<u8>(), 0..1024)) {
            prop_assert_eq!(hash_bytes(&data), hash_bytes(&data));
        }
    }
}
