use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InboxStatus {
    New,
    Parsed,
    NeedsReview,
    Approved,
    Rejected,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ReviewerId(String);

impl ReviewerId {
    pub fn new(id: String) -> Result<Self, InboxError> {
        if id.is_empty() || id.trim() != id || id.chars().any(char::is_control) {
            return Err(InboxError::InvalidReviewer);
        }
        Ok(Self(id))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InboxAction {
    MarkParsed,
    RequestReview,
    Approve { reviewer: ReviewerId },
    Reject { reviewer: ReviewerId },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct InboxTransition {
    pub from: InboxStatus,
    pub to: InboxStatus,
    pub reviewer: Option<ReviewerId>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum InboxError {
    #[error("для ручного рішення потрібен ідентифікатор рецензента")]
    InvalidReviewer,
    #[error("недозволений перехід стану черги")]
    InvalidTransition,
}

pub fn transition(from: InboxStatus, action: InboxAction) -> Result<InboxTransition, InboxError> {
    let (to, reviewer) = match (from, action) {
        (InboxStatus::New, InboxAction::MarkParsed) => (InboxStatus::Parsed, None),
        (InboxStatus::New | InboxStatus::Parsed, InboxAction::RequestReview) => {
            (InboxStatus::NeedsReview, None)
        }
        (InboxStatus::NeedsReview, InboxAction::Approve { reviewer }) => {
            (InboxStatus::Approved, Some(reviewer))
        }
        (InboxStatus::NeedsReview, InboxAction::Reject { reviewer }) => {
            (InboxStatus::Rejected, Some(reviewer))
        }
        _ => return Err(InboxError::InvalidTransition),
    };

    Ok(InboxTransition { from, to, reviewer })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reviewer() -> ReviewerId {
        ReviewerId::new("reviewer-demo".to_owned()).expect("синтетичний рецензент коректний")
    }

    #[test]
    fn approval_requires_review_and_reviewer_id() {
        assert_eq!(
            transition(
                InboxStatus::New,
                InboxAction::Approve {
                    reviewer: reviewer()
                }
            ),
            Err(InboxError::InvalidTransition)
        );
        assert_eq!(
            transition(
                InboxStatus::Parsed,
                InboxAction::Approve {
                    reviewer: reviewer()
                }
            ),
            Err(InboxError::InvalidTransition)
        );

        let parsed = transition(InboxStatus::New, InboxAction::MarkParsed).unwrap();
        let review = transition(parsed.to, InboxAction::RequestReview).unwrap();
        let approved = transition(
            review.to,
            InboxAction::Approve {
                reviewer: reviewer(),
            },
        )
        .unwrap();
        assert_eq!(approved.to, InboxStatus::Approved);
        assert_eq!(approved.reviewer, Some(reviewer()));
    }

    #[test]
    fn review_can_reject_and_final_states_cannot_reopen() {
        let review = transition(InboxStatus::New, InboxAction::RequestReview).unwrap();
        let rejected = transition(
            review.to,
            InboxAction::Reject {
                reviewer: reviewer(),
            },
        )
        .unwrap();
        assert_eq!(rejected.to, InboxStatus::Rejected);
        assert_eq!(rejected.reviewer, Some(reviewer()));
        assert_eq!(
            transition(InboxStatus::Rejected, InboxAction::RequestReview),
            Err(InboxError::InvalidTransition)
        );
        assert_eq!(
            transition(InboxStatus::Approved, InboxAction::RequestReview),
            Err(InboxError::InvalidTransition)
        );
    }

    #[test]
    fn blank_reviewer_is_rejected() {
        assert_eq!(
            ReviewerId::new(" ".to_owned()),
            Err(InboxError::InvalidReviewer)
        );
        assert_eq!(
            ReviewerId::new("reviewer\ndemo".to_owned()),
            Err(InboxError::InvalidReviewer)
        );
    }

    #[test]
    fn status_names_match_the_inbox_contract() {
        assert_eq!(
            serde_json::to_string(&InboxStatus::NeedsReview).unwrap(),
            "\"NEEDS_REVIEW\""
        );
    }
}
