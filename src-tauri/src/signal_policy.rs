use serde::Serialize;
use std::{
    net::{Ipv4Addr, SocketAddr},
    path::{Component, PathBuf},
};

pub const SIGNAL_HTTP_RPC_PATH: &str = "/api/v1/rpc";
pub const SIGNAL_HTTP_EVENTS_PATH: &str = "/api/v1/events";
pub const SIGNAL_HTTP_CHECK_PATH: &str = "/api/v1/check";

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "transport", rename_all = "snake_case")]
pub enum SignalDaemonEndpoint {
    UnixSocket { path: PathBuf },
    Tcp { address: SocketAddr },
    Http { address: SocketAddr },
}

impl SignalDaemonEndpoint {
    fn validate(&self) -> Result<(), SignalPolicyError> {
        match self {
            Self::UnixSocket { path } => {
                let has_parent_traversal = path
                    .components()
                    .any(|component| component == Component::ParentDir);
                if !path.is_absolute() || has_parent_traversal || path.file_name().is_none() {
                    return Err(SignalPolicyError::InvalidUnixSocketPath);
                }
            }
            Self::Tcp { address } | Self::Http { address } => {
                if !address.ip().is_loopback() {
                    return Err(SignalPolicyError::NonLoopbackAddress(*address));
                }
            }
        }

        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SignalReceiveMode {
    Manual,
    OnStart,
    OnConnection,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SignalAdapterConfig {
    pub endpoint: SignalDaemonEndpoint,
    pub receive_mode: SignalReceiveMode,
    pub intake_enabled: bool,
    pub allowlist_configured: bool,
    pub auto_approve: bool,
}

impl Default for SignalAdapterConfig {
    fn default() -> Self {
        Self {
            endpoint: SignalDaemonEndpoint::Http {
                address: SocketAddr::from((Ipv4Addr::LOCALHOST, 8080)),
            },
            receive_mode: SignalReceiveMode::Manual,
            intake_enabled: false,
            allowlist_configured: false,
            auto_approve: false,
        }
    }
}

impl SignalAdapterConfig {
    pub fn validate(self) -> Result<ValidatedSignalAdapterConfig, SignalPolicyError> {
        self.endpoint.validate()?;

        if self.receive_mode != SignalReceiveMode::Manual {
            return Err(SignalPolicyError::ManualReceiveRequired);
        }
        if self.auto_approve {
            return Err(SignalPolicyError::AutoApprovalForbidden);
        }
        if self.intake_enabled && !self.allowlist_configured {
            return Err(SignalPolicyError::AllowlistRequired);
        }

        Ok(ValidatedSignalAdapterConfig(self))
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(transparent)]
pub struct ValidatedSignalAdapterConfig(SignalAdapterConfig);

impl ValidatedSignalAdapterConfig {
    pub fn as_config(&self) -> &SignalAdapterConfig {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum SignalPolicyError {
    #[error("UNIX socket signal-cli має бути абсолютним локальним шляхом без '..'")]
    InvalidUnixSocketPath,
    #[error("signal-cli дозволено підключати лише до loopback-адреси; отримано {0}")]
    NonLoopbackAddress(SocketAddr),
    #[error("signal-cli має працювати в ручному режимі отримання")]
    ManualReceiveRequired,
    #[error("перед увімкненням Signal intake потрібно налаштувати allowlist")]
    AllowlistRequired,
    #[error("автоматичне схвалення записів із Signal заборонене")]
    AutoApprovalForbidden,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv6Addr};

    #[test]
    fn default_policy_is_local_manual_and_disabled() {
        let validated = SignalAdapterConfig::default()
            .validate()
            .expect("безпечна конфігурація за замовчуванням має бути дійсною");
        let config = validated.as_config();

        assert_eq!(config.receive_mode, SignalReceiveMode::Manual);
        assert!(!config.intake_enabled);
        assert!(!config.allowlist_configured);
        assert!(!config.auto_approve);
        assert_eq!(
            config.endpoint,
            SignalDaemonEndpoint::Http {
                address: SocketAddr::from((Ipv4Addr::LOCALHOST, 8080)),
            }
        );
    }

    #[test]
    fn remote_tcp_and_http_addresses_are_rejected() {
        for endpoint in [
            SignalDaemonEndpoint::Tcp {
                address: SocketAddr::new(IpAddr::V4(Ipv4Addr::new(192, 0, 2, 10)), 7583),
            },
            SignalDaemonEndpoint::Http {
                address: SocketAddr::new(
                    IpAddr::V6(Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 10)),
                    8080,
                ),
            },
        ] {
            let result = SignalAdapterConfig {
                endpoint,
                ..SignalAdapterConfig::default()
            }
            .validate();

            match result {
                Err(SignalPolicyError::NonLoopbackAddress(address)) => {
                    assert!(!address.ip().is_loopback());
                }
                _ => panic!("очікувалась помилка non-loopback address"),
            }
        }
    }

    #[test]
    fn intake_cannot_start_without_allowlist() {
        let result = SignalAdapterConfig {
            intake_enabled: true,
            ..SignalAdapterConfig::default()
        }
        .validate();

        assert_eq!(result, Err(SignalPolicyError::AllowlistRequired));
    }

    #[test]
    fn automatic_approval_is_always_rejected() {
        let result = SignalAdapterConfig {
            auto_approve: true,
            ..SignalAdapterConfig::default()
        }
        .validate();

        assert_eq!(result, Err(SignalPolicyError::AutoApprovalForbidden));
    }

    #[test]
    fn non_manual_receive_modes_are_rejected() {
        for receive_mode in [SignalReceiveMode::OnStart, SignalReceiveMode::OnConnection] {
            let result = SignalAdapterConfig {
                receive_mode,
                ..SignalAdapterConfig::default()
            }
            .validate();

            assert_eq!(result, Err(SignalPolicyError::ManualReceiveRequired));
        }
    }

    #[test]
    fn unix_socket_must_use_an_absolute_traversal_free_path() {
        for path in [
            PathBuf::from("signal-cli/socket"),
            PathBuf::from("/tmp/../socket"),
        ] {
            let result = SignalAdapterConfig {
                endpoint: SignalDaemonEndpoint::UnixSocket { path },
                ..SignalAdapterConfig::default()
            }
            .validate();

            assert_eq!(result, Err(SignalPolicyError::InvalidUnixSocketPath));
        }
    }

    #[test]
    fn enabled_intake_accepts_only_an_explicit_allowlist_policy() {
        let validated = SignalAdapterConfig {
            endpoint: SignalDaemonEndpoint::Tcp {
                address: SocketAddr::from((Ipv4Addr::LOCALHOST, 7583)),
            },
            intake_enabled: true,
            allowlist_configured: true,
            ..SignalAdapterConfig::default()
        }
        .validate()
        .expect("локальна конфігурація з allowlist має бути дійсною");

        assert!(validated.as_config().intake_enabled);
        assert!(validated.as_config().allowlist_configured);
        assert!(!validated.as_config().auto_approve);
    }

    #[test]
    fn official_http_paths_are_kept_explicit() {
        assert_eq!(SIGNAL_HTTP_RPC_PATH, "/api/v1/rpc");
        assert_eq!(SIGNAL_HTTP_EVENTS_PATH, "/api/v1/events");
        assert_eq!(SIGNAL_HTTP_CHECK_PATH, "/api/v1/check");
    }
}
