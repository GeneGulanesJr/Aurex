use colored::Colorize;
use serde::Serialize;

use crate::commands::OutputFormat;

pub fn render_message<T: Serialize>(
    format: OutputFormat,
    text: &str,
    json: &T,
) -> anyhow::Result<String> {
    match format {
        OutputFormat::Text => Ok(text.green().to_string()),
        OutputFormat::Json => Ok(serde_json::to_string_pretty(json)?),
    }
}
