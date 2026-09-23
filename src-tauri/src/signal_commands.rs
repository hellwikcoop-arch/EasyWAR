use crate::repository::SignalCommandQueueSnapshot;

const MAX_COMMAND_CHARS: usize = 64;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SignalCommand {
    Help,
    Status,
    Ping,
    Queue,
    Last,
    Unknown,
}

impl SignalCommand {
    pub fn needs_queue_snapshot(self) -> bool {
        matches!(self, Self::Queue | Self::Last)
    }
}

pub fn parse_command(message: &str) -> Option<SignalCommand> {
    let trimmed = message.trim();
    if !trimmed.starts_with('/') {
        return None;
    }
    if trimmed.chars().count() > MAX_COMMAND_CHARS
        || trimmed.chars().any(|character| character.is_control())
        || trimmed.split_whitespace().count() != 1
    {
        return Some(SignalCommand::Unknown);
    }

    Some(match trimmed.to_ascii_lowercase().as_str() {
        "/help" => SignalCommand::Help,
        "/status" => SignalCommand::Status,
        "/ping" => SignalCommand::Ping,
        "/queue" => SignalCommand::Queue,
        "/last" => SignalCommand::Last,
        _ => SignalCommand::Unknown,
    })
}

pub fn render_response(
    command: SignalCommand,
    snapshot: Option<&SignalCommandQueueSnapshot>,
) -> String {
    match command {
        SignalCommand::Help => [
            "Команди EasyWAR:",
            "/help — ця довідка",
            "/status — стан явного сеансу",
            "/ping — перевірка відповіді",
            "/queue — кількість записів за станами",
            "/last — час і стан останнього запису",
        ]
        .join("\n"),
        SignalCommand::Status => "EasyWAR: явний обмежений сеанс Signal активний. Автоматичне приймання та автоматичне схвалення вимкнені.".to_owned(),
        SignalCommand::Ping => "EasyWAR відповідає. Локальний сеанс Signal активний.".to_owned(),
        SignalCommand::Queue => {
            let snapshot = snapshot.expect("queue command requires a repository snapshot");
            format!(
                "Черга Signal: усього {}. Нові: {}; розібрані: {}; на перевірці: {}; схвалені: {}; відхилені: {}.",
                snapshot.total,
                snapshot.new_count,
                snapshot.parsed_count,
                snapshot.needs_review_count,
                snapshot.approved_count,
                snapshot.rejected_count,
            )
        }
        SignalCommand::Last => {
            let snapshot = snapshot.expect("last command requires a repository snapshot");
            match &snapshot.last {
                Some(last) => format!(
                    "Останній запис Signal: час захоплення {}; стан {}.",
                    last.captured_at, last.current_status
                ),
                None => "Черга Signal порожня.".to_owned(),
            }
        }
        SignalCommand::Unknown => {
            "Невідома команда EasyWAR. Надішліть /help для переліку команд.".to_owned()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repository::SignalCommandLastItem;

    fn snapshot() -> SignalCommandQueueSnapshot {
        SignalCommandQueueSnapshot {
            total: 5,
            new_count: 1,
            parsed_count: 1,
            needs_review_count: 1,
            approved_count: 1,
            rejected_count: 1,
            last: Some(SignalCommandLastItem {
                captured_at: "2026-01-01T00:00:00Z".to_owned(),
                current_status: "NEW".to_owned(),
            }),
        }
    }

    #[test]
    fn parses_only_exact_bounded_slash_commands() {
        assert_eq!(parse_command(" /HELP "), Some(SignalCommand::Help));
        assert_eq!(parse_command("/status"), Some(SignalCommand::Status));
        assert_eq!(parse_command("/ping"), Some(SignalCommand::Ping));
        assert_eq!(parse_command("/queue"), Some(SignalCommand::Queue));
        assert_eq!(parse_command("/last"), Some(SignalCommand::Last));
        assert_eq!(parse_command("звичайна доповідь"), None);
        assert_eq!(parse_command("/queue now"), Some(SignalCommand::Unknown));
        assert_eq!(parse_command("/unknown"), Some(SignalCommand::Unknown));
        assert_eq!(
            parse_command(&format!("/{}", "x".repeat(MAX_COMMAND_CHARS))),
            Some(SignalCommand::Unknown)
        );
    }

    #[test]
    fn responses_expose_only_bounded_queue_metadata() {
        let snapshot = snapshot();
        let queue = render_response(SignalCommand::Queue, Some(&snapshot));
        let last = render_response(SignalCommand::Last, Some(&snapshot));

        assert!(queue.contains("усього 5"));
        assert!(last.contains("2026-01-01T00:00:00Z"));
        assert!(last.contains("NEW"));
        for secret in ["report-id", "raw_sha256", "source-item", "message"] {
            assert!(!queue.contains(secret));
            assert!(!last.contains(secret));
        }
    }

    #[test]
    fn empty_last_response_is_explicit() {
        let mut snapshot = snapshot();
        snapshot.last = None;
        assert_eq!(
            render_response(SignalCommand::Last, Some(&snapshot)),
            "Черга Signal порожня."
        );
    }
}
