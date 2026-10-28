# Contributing

Thanks for helping. A few ground rules keep Passfair safe to ship to app stores:

1. **Core stays pure.** `src/core/*` must not import React, React Native or storage. It is tested with `node --test` and has no network in tests.
2. **Keys never leave the keychain.** Do not log, persist or transmit API keys anywhere except the vendor's own endpoint.
3. **Provider error bodies are never shown.** They can echo the prompt. Surface the HTTP status and a hint only.
4. **Fixed endpoints.** No user-configurable base URLs for model providers.
5. **No analytics or tracking SDKs.** The privacy policy promises none.
6. Run `npm test && npm run typecheck` before a PR. CI runs the same plus a web export.

Bug reports: include the platform, app version (Settings → About, or `app.json`), and whether the job was demo or live. Never paste API keys or full provider responses into an issue.
