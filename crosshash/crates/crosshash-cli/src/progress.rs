use indicatif::{ProgressBar, ProgressStyle};

#[allow(dead_code)]
pub fn spinner(message: impl Into<String>) -> ProgressBar {
    let pb = ProgressBar::new_spinner();
    pb.set_style(
        ProgressStyle::with_template("{spinner:.green} {msg}")
            .unwrap_or_else(|_| ProgressStyle::default_spinner()),
    );
    pb.set_message(message.into());
    pb.enable_steady_tick(std::time::Duration::from_millis(120));
    pb
}

#[allow(dead_code)]
pub fn progress_bar(len: u64, message: impl Into<String>) -> ProgressBar {
    let pb = ProgressBar::new(len);
    pb.set_style(
        ProgressStyle::with_template("{bar:40.cyan/blue} {pos}/{len} {msg}")
            .unwrap_or_else(|_| ProgressStyle::default_bar()),
    );
    pb.set_message(message.into());
    pb
}
