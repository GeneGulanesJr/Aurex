mod commands;
mod output;
mod progress;

use clap::Parser;
use commands::Cli;

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let rt = tokio::runtime::Runtime::new()?;
    rt.block_on(cli.execute_async())
}
