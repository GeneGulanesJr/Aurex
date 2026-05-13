use thiserror::Error;

pub type Result<T> = std::result::Result<T, CoreError>;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("storage error: {0}")]
    StorageError(String),
    #[error("migration error: {0}")]
    MigrationError(String),
    #[error("parse error: {0}")]
    ParseError(String),
    #[error("hash error: {0}")]
    HashError(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("unsupported language: {0}")]
    UnsupportedLanguage(String),
    #[error("I/O error: {0}")]
    Io(String),
    #[error("git error: {0}")]
    GitError(String),
}
