mod commands;
mod output;
mod progress;

use clap::Parser;
use commands::{Cli, Execute};

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    cli.execute()
}
