# macOS packaging

## Verifiable local debug bundle

Run this on macOS:

```bash
npm run build:macos:adhoc
```

The command merges `src-tauri/tauri.adhoc.conf.json` with the normal Tauri
configuration, builds the debug app and DMG, and then verifies both artifacts.
The overlay sets Tauri's documented pseudo-identity `-`, so `codesign` creates
an ad-hoc bundle signature without selecting or consuming an Apple certificate
from the user's Keychain.

The verifier requires:

- strict recursive `codesign` validation of `EasyWAR.app`;
- a valid DMG checksum according to `hdiutil verify`;
- a printed SHA-256 checksum for the resulting DMG.

Expected artifacts:

- `src-tauri/target/debug/bundle/macos/EasyWAR.app`
- `src-tauri/target/debug/bundle/dmg/EasyWAR_0.5.0_aarch64.dmg`

Ad-hoc signing proves bundle integrity for local development. It does **not**
establish publisher identity, satisfy Gatekeeper for general distribution, or
replace notarization.

## Production signing boundary

The normal `src-tauri/tauri.conf.json` intentionally does not pin a signing
identity. A production build must receive a deliberate `Developer ID
Application` identity through the documented Tauri configuration or
`APPLE_SIGNING_IDENTITY`, plus separately supplied notarization credentials.
Do not commit certificates, passwords, API keys, Apple IDs, team IDs, or
notarization credentials. A successful ad-hoc build must never be described as
the signed or notarized 1.0 release.

Reference: [Tauri macOS code signing](https://v2.tauri.app/distribute/sign/macos/).
