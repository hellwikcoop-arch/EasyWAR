# Архітектурні рішення (ADR)

Тут лежать записи архітектурних рішень EasyWAR. Статус «Запропоновано» означає: рішення
описане, але **не затверджене власником** і не дозволяє реалізацію. Затвердження власника
записується в самому ADR із датою і посиланням на відповідний розділ `COLLECTIVES_PLAN.md`
або `MODULES_ROADMAP.md`.

| ADR | Тема | Етапи | Статус |
|---|---|---|---|
| [collective-pairing.md](collective-pairing.md) | Вступ до колективу за коротким кодом (Pair) | C1c, C2p, C6a, C5 | Запропоновано; напрям — рішення власника JE-02 (21.10.2026) |
| [collective-sync-policies.md](collective-sync-policies.md) | Комбінована синхронізація: політики відправки й застосування | C1d, C3b, C5 | Запропоновано |
| [lan-relay-handover.md](lan-relay-handover.md) | Посередник (relay) і передача ролі host у LAN; WAN — C8 | C6b, C8 | Запропоновано |
| [collective-store-forward.md](collective-store-forward.md) | Тимчасове зберігання зашифрованих пакетів | C4, C6c, C8 | Запропоновано |
| [collective-crypto.md](collective-crypto.md) | Криптопрофіль і ідентичність колективу | C2a, C2, C2p | Рішення власника 29.10.2026: JE-15 варіант Б (умовно, gate G12), JE-16 варіант а; реалізація — окремий наказ C2 |
| [network-and-secret-boundaries.md](network-and-secret-boundaries.md) | Мережеві межі (`networkPolicy`), сховище секретів, перелік ресурсів для CSP | P1, C3b, C2, C6a | Рішення власника 29.10.2026: JE-18 варіант Ф, JE-21 варіант а (окремий CSP PR, listener після приймання CSP); модуль `network_policy.rs` без IPC |

Джерело: [`plans/2026-10-21-easywar-sync-pair-mesh-review.md`](../plans/2026-10-21-easywar-sync-pair-mesh-review.md)
(рев'ю J3 пакета J5 «EasyWAR Sync + Pair + Mesh v0.1»). Відкриті рішення власника JE-01…JE-21
перелічено в розділі 5 того документа.

Ще не створено, але вже заплановано іншими планами: `base44-auth-transport.md` (A1, [`plans/2026-10-21-easywar-accounts-sync.md`](../plans/2026-10-21-easywar-accounts-sync.md)).
