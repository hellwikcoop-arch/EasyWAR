//! Перший шар єдиної політики обміну (P1, ADR `docs/adr/network-and-secret-boundaries.md`):
//! чиста функція `network_policy(context, purpose)` → дозволено / відхилено з причиною.
//!
//! Модуль не робить мережевих викликів і не має команд Tauri: наявні виклики
//! (`weather_online`, `model_install`, `app_update`, `signal_daemon`) його ще не викликають,
//! таблиця відповідності — в ADR. Підключення до команд — етап C3b після рішень JE-18 і JE-21.
//! Невідоме призначення, вікно без права на мережу й усі `collective_*` відхиляються за
//! замовчуванням; `collective_*` лишаються відхиленими до C3b незалежно від контексту.

use std::fmt;

/// Мітка головного вікна — єдиного, з якого команди можуть ініціювати мережевий виклик.
pub const MAIN_WINDOW_LABEL: &str = "main";

/// Призначення мережевого виклику. Перелік закритий: нове призначення додається лише разом
/// із рядком в ADR і тестом `tests/network-boundary.test.mjs`.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum Purpose {
    /// Прогноз Open-Meteo для модуля «Обстановка» (вихідний HTTPS, лише округлені координати).
    WeatherOnline,
    /// Завантаження файла локальної моделі з джерела, яке користувач підтвердив у діалозі.
    ModelInstall,
    /// Перевірка й завантаження оновлення застосунку (`tauri-plugin-updater`).
    AppUpdate {
        /// `true` — користувач натиснув «Перевірити оновлення»; `false` — щоденна автоперевірка.
        manual: bool,
    },
    /// JSON-RPC до локального `signal-cli` лише на loopback-адресі.
    SignalDaemon {
        /// Чи адреса демона — loopback (перевіряє `signal_policy`).
        loopback: bool,
    },
    /// Прямий обмін колективу в LAN (C6a). До C3b — завжди відхилено.
    CollectiveLan,
    /// Транспорт Base44 колективу (C4). До C3b і G01–G05 — завжди відхилено.
    CollectiveBase44,
    /// WAN Pair Mesh через інший EasyWAR/relay. До C8 і безпекових gates — відхилено.
    CollectivePeerWan,
}

impl Purpose {
    /// Усі відомі призначення в порядку таблиці ADR (для тестів і діагностики).
    pub const ALL: [Purpose; 7] = [
        Purpose::WeatherOnline,
        Purpose::ModelInstall,
        Purpose::AppUpdate { manual: true },
        Purpose::SignalDaemon { loopback: true },
        Purpose::CollectiveLan,
        Purpose::CollectiveBase44,
        Purpose::CollectivePeerWan,
    ];

    /// Ім'я призначення, як воно записане в ADR і в журналі.
    pub fn name(self) -> &'static str {
        match self {
            Purpose::WeatherOnline => "weather_online",
            Purpose::ModelInstall => "model_install",
            Purpose::AppUpdate { .. } => "app_update",
            Purpose::SignalDaemon { .. } => "signal_daemon",
            Purpose::CollectiveLan => "collective_lan",
            Purpose::CollectiveBase44 => "collective_base44",
            Purpose::CollectivePeerWan => "collective_peer_wan",
        }
    }

    /// Розбір імені з журналу чи налаштувань. Невідоме ім'я → `None`, і політика його
    /// відхиляє ([`Denied::UnknownPurpose`]); параметри `manual`/`loopback` беруться
    /// найсуворіші (автоматично, не loopback), тож розбір ніколи не розширює дозвіл.
    pub fn parse(name: &str) -> Option<Purpose> {
        match name {
            "weather_online" => Some(Purpose::WeatherOnline),
            "model_install" => Some(Purpose::ModelInstall),
            "app_update" => Some(Purpose::AppUpdate { manual: false }),
            "signal_daemon" => Some(Purpose::SignalDaemon { loopback: false }),
            "collective_lan" => Some(Purpose::CollectiveLan),
            "collective_base44" => Some(Purpose::CollectiveBase44),
            "collective_peer_wan" => Some(Purpose::CollectivePeerWan),
            _ => None,
        }
    }

    /// Чи призначення належить майбутньому колективу (E8): до C3b відхиляється завжди.
    pub fn is_collective(self) -> bool {
        matches!(
            self,
            Purpose::CollectiveLan | Purpose::CollectiveBase44 | Purpose::CollectivePeerWan
        )
    }
}

/// Стан профілю й налаштувань, від якого залежить рішення. Жодних секретів: лише прапорці.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkContext<'a> {
    /// Мітка вікна Tauri, з якого надійшов виклик.
    pub window_label: &'a str,
    /// Чи відкрито профіль (без профілю мережевих дій немає).
    pub profile_open: bool,
    /// Чи профіль має пароль (умова для ключів колективу, `COLLECTIVES_PLAN.md` §6).
    pub profile_has_password: bool,
    /// Налаштування «Обстановки»: онлайн-оновлення ввімкнено користувачем.
    pub weather_online_enabled: bool,
    /// Налаштування оновлень: щоденна автоперевірка ввімкнена.
    pub auto_update_enabled: bool,
    /// Користувач підтвердив у нативному діалозі саме це завантаження моделі.
    pub model_install_confirmed: bool,
    /// Налаштування Signal: приймання ввімкнено й перелік відправників непорожній.
    pub signal_intake_enabled: bool,
}

impl<'a> NetworkContext<'a> {
    /// Контекст без жодного дозволу: усе вимкнено, профіль закритий. Будь-який дозвіл
    /// треба вмикати явно, тож тести починають звідси.
    pub const fn closed(window_label: &'a str) -> Self {
        Self {
            window_label,
            profile_open: false,
            profile_has_password: false,
            weather_online_enabled: false,
            auto_update_enabled: false,
            model_install_confirmed: false,
            signal_intake_enabled: false,
        }
    }
}

/// Причина відмови. Тексти — для журналу й інтерфейсу, без адрес і без даних.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum Denied {
    /// Виклик не з головного вікна (редактор «Офісу» чи інше вікно з даними мережі не має).
    WindowNotAllowed,
    /// Профіль не відкрито.
    ProfileClosed,
    /// Призначення не з переліку ADR.
    UnknownPurpose,
    /// Користувач не ввімкнув цю інтеграцію в налаштуваннях.
    IntegrationDisabled,
    /// Немає підтвердження користувача на саме цей виклик.
    NotConfirmed,
    /// Адреса не loopback (лише для `signal_daemon`).
    NotLoopback,
    /// Профіль без пароля не може тримати ключі колективу.
    ProfileWithoutPassword,
    /// Етап ще не дозволено власником (C3b, C4, C6a).
    StageNotAuthorized,
}

impl Denied {
    /// Пояснення українською для журналу й повідомлень; без деталей запиту.
    pub fn message(self) -> &'static str {
        match self {
            Denied::WindowNotAllowed => "мережеві виклики дозволені лише головному вікну",
            Denied::ProfileClosed => "профіль не відкрито",
            Denied::UnknownPurpose => "невідоме призначення мережевого виклику",
            Denied::IntegrationDisabled => "інтеграцію вимкнено в налаштуваннях",
            Denied::NotConfirmed => "немає підтвердження користувача на цей виклик",
            Denied::NotLoopback => "дозволено лише loopback-адресу",
            Denied::ProfileWithoutPassword => "для колективу профіль має мати пароль",
            Denied::StageNotAuthorized => "цей обмін ще не дозволено власником",
        }
    }
}

impl fmt::Display for Denied {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

/// Результат політики.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Verdict {
    Allowed,
    Denied(Denied),
}

impl Verdict {
    pub fn is_allowed(self) -> bool {
        matches!(self, Verdict::Allowed)
    }
}

/// Єдина точка рішення. Порядок перевірок сталий: вікно → профіль → призначення →
/// умови призначення. Перша невиконана умова дає причину; дозвіл — лише якщо виконано всі.
pub fn network_policy(context: &NetworkContext<'_>, purpose: Purpose) -> Verdict {
    if context.window_label != MAIN_WINDOW_LABEL {
        return Verdict::Denied(Denied::WindowNotAllowed);
    }
    if !context.profile_open {
        return Verdict::Denied(Denied::ProfileClosed);
    }
    let denied = match purpose {
        Purpose::WeatherOnline if !context.weather_online_enabled => {
            Some(Denied::IntegrationDisabled)
        }
        Purpose::WeatherOnline => None,
        Purpose::ModelInstall if !context.model_install_confirmed => Some(Denied::NotConfirmed),
        Purpose::ModelInstall => None,
        Purpose::AppUpdate { manual: true } => None,
        Purpose::AppUpdate { manual: false } if !context.auto_update_enabled => {
            Some(Denied::IntegrationDisabled)
        }
        Purpose::AppUpdate { manual: false } => None,
        Purpose::SignalDaemon { loopback: false } => Some(Denied::NotLoopback),
        Purpose::SignalDaemon { loopback: true } if !context.signal_intake_enabled => {
            Some(Denied::IntegrationDisabled)
        }
        Purpose::SignalDaemon { loopback: true } => None,
        Purpose::CollectiveLan | Purpose::CollectiveBase44 | Purpose::CollectivePeerWan
            if !context.profile_has_password =>
        {
            Some(Denied::ProfileWithoutPassword)
        }
        // До C3b жоден транспорт колективу не дозволений, хай би які були налаштування.
        Purpose::CollectiveLan | Purpose::CollectiveBase44 | Purpose::CollectivePeerWan => {
            Some(Denied::StageNotAuthorized)
        }
    };
    match denied {
        Some(reason) => Verdict::Denied(reason),
        None => Verdict::Allowed,
    }
}

/// Рішення за іменем призначення (журнал, налаштування): невідоме ім'я відхиляється.
pub fn network_policy_by_name(context: &NetworkContext<'_>, purpose: &str) -> Verdict {
    match Purpose::parse(purpose) {
        Some(purpose) => network_policy(context, purpose),
        None => Verdict::Denied(Denied::UnknownPurpose),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_main() -> NetworkContext<'static> {
        NetworkContext {
            profile_open: true,
            ..NetworkContext::closed(MAIN_WINDOW_LABEL)
        }
    }

    #[test]
    fn closed_context_denies_every_purpose() {
        let context = NetworkContext::closed(MAIN_WINDOW_LABEL);
        for purpose in Purpose::ALL {
            assert_eq!(
                network_policy(&context, purpose),
                Verdict::Denied(Denied::ProfileClosed),
                "{}",
                purpose.name()
            );
        }
    }

    #[test]
    fn only_the_main_window_may_reach_the_network() {
        let mut context = open_main();
        context.weather_online_enabled = true;
        context.model_install_confirmed = true;
        context.auto_update_enabled = true;
        context.signal_intake_enabled = true;
        context.profile_has_password = true;
        for label in ["office-editor", "office-editor-2", "", "MAIN", "main2"] {
            let context = NetworkContext {
                window_label: label,
                ..context.clone()
            };
            for purpose in Purpose::ALL {
                assert_eq!(
                    network_policy(&context, purpose),
                    Verdict::Denied(Denied::WindowNotAllowed),
                    "{label}/{}",
                    purpose.name()
                );
            }
        }
    }

    #[test]
    fn weather_follows_the_online_setting() {
        let mut context = open_main();
        assert_eq!(
            network_policy(&context, Purpose::WeatherOnline),
            Verdict::Denied(Denied::IntegrationDisabled)
        );
        context.weather_online_enabled = true;
        assert!(network_policy(&context, Purpose::WeatherOnline).is_allowed());
    }

    #[test]
    fn model_install_needs_a_confirmation_for_this_download() {
        let mut context = open_main();
        assert_eq!(
            network_policy(&context, Purpose::ModelInstall),
            Verdict::Denied(Denied::NotConfirmed)
        );
        context.model_install_confirmed = true;
        assert!(network_policy(&context, Purpose::ModelInstall).is_allowed());
    }

    #[test]
    fn manual_update_check_is_allowed_automatic_only_when_enabled() {
        let mut context = open_main();
        assert!(network_policy(&context, Purpose::AppUpdate { manual: true }).is_allowed());
        assert_eq!(
            network_policy(&context, Purpose::AppUpdate { manual: false }),
            Verdict::Denied(Denied::IntegrationDisabled)
        );
        context.auto_update_enabled = true;
        assert!(network_policy(&context, Purpose::AppUpdate { manual: false }).is_allowed());
    }

    #[test]
    fn signal_daemon_requires_loopback_and_enabled_intake() {
        let mut context = open_main();
        context.signal_intake_enabled = true;
        assert_eq!(
            network_policy(&context, Purpose::SignalDaemon { loopback: false }),
            Verdict::Denied(Denied::NotLoopback)
        );
        assert!(network_policy(&context, Purpose::SignalDaemon { loopback: true }).is_allowed());
        context.signal_intake_enabled = false;
        assert_eq!(
            network_policy(&context, Purpose::SignalDaemon { loopback: true }),
            Verdict::Denied(Denied::IntegrationDisabled)
        );
    }

    #[test]
    fn collective_transports_stay_denied_until_c3b() {
        let mut context = open_main();
        for purpose in [
            Purpose::CollectiveLan,
            Purpose::CollectiveBase44,
            Purpose::CollectivePeerWan,
        ] {
            assert_eq!(
                network_policy(&context, purpose),
                Verdict::Denied(Denied::ProfileWithoutPassword),
                "{}",
                purpose.name()
            );
        }
        context.profile_has_password = true;
        context.weather_online_enabled = true;
        context.auto_update_enabled = true;
        for purpose in [
            Purpose::CollectiveLan,
            Purpose::CollectiveBase44,
            Purpose::CollectivePeerWan,
        ] {
            assert_eq!(
                network_policy(&context, purpose),
                Verdict::Denied(Denied::StageNotAuthorized),
                "{}",
                purpose.name()
            );
            assert!(purpose.is_collective());
        }
    }

    #[test]
    fn unknown_purpose_is_denied_and_names_round_trip() {
        let mut context = open_main();
        context.weather_online_enabled = true;
        assert_eq!(
            network_policy_by_name(&context, "telemetry"),
            Verdict::Denied(Denied::UnknownPurpose)
        );
        assert_eq!(
            network_policy_by_name(&context, ""),
            Verdict::Denied(Denied::UnknownPurpose)
        );
        assert!(network_policy_by_name(&context, "weather_online").is_allowed());
        for purpose in Purpose::ALL {
            let parsed =
                Purpose::parse(purpose.name()).unwrap_or_else(|| panic!("{}", purpose.name()));
            assert_eq!(parsed.name(), purpose.name());
        }
        // Розбір бере найсуворіший варіант: автоматична перевірка, не loopback.
        assert_eq!(
            Purpose::parse("app_update"),
            Some(Purpose::AppUpdate { manual: false })
        );
        assert_eq!(
            Purpose::parse("signal_daemon"),
            Some(Purpose::SignalDaemon { loopback: false })
        );
    }

    #[test]
    fn denial_messages_are_ukrainian_and_carry_no_request_details() {
        let reasons = [
            Denied::WindowNotAllowed,
            Denied::ProfileClosed,
            Denied::UnknownPurpose,
            Denied::IntegrationDisabled,
            Denied::NotConfirmed,
            Denied::NotLoopback,
            Denied::ProfileWithoutPassword,
            Denied::StageNotAuthorized,
        ];
        for reason in reasons {
            let text = reason.to_string();
            assert!(!text.is_empty());
            assert!(text
                .chars()
                .any(|c| ('а'..='я').contains(&c) || "іїєґ".contains(c)));
            assert!(!text.contains("http"), "{text}");
        }
    }
}
