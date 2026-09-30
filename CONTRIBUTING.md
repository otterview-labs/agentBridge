# Contributing

Thanks for helping improve agentBridge.

## Before opening a change

- Use GitHub Issues for confirmed bugs and focused feature proposals.
- Report security problems privately as described in [`SECURITY.md`](SECURITY.md).
- Keep changes narrowly scoped and avoid committing credentials, keystores,
  logs, session transcripts, or machine-specific paths.

## Development setup

Requirements: JDK 17, the Android SDK (platform 35, build-tools 35.0.0), and
Node.js 20 or later for the tests.

```bash
cd android
./gradlew assembleDebug

cd tests
npm ci
npx playwright install chromium
npm test
```

CI runs the same build and tests on every pull request. See
[`docs/android-app.md`](docs/android-app.md#tests) for what each test file
covers.

## Pull requests

- Add or update tests for behavioral changes. Shell that runs on remote
  machines should live in a class that can be tested without Android, like
  `FrpInstallSupport` and `RemoteReply`, with a test that runs it.
- Treat everything that builds a remote command, stores a credential, or
  exposes a method to the WebView as security-sensitive. Quote every value that
  reaches a shell, and never return stored credentials to JavaScript.
- Do not copy source code, prose, assets, or protocol implementations from
  other projects without first establishing license compatibility and
  attribution requirements.
- Update the README and `docs/android-app.md` when behavior changes.
- Explain remaining risks and manual verification in the pull request description.
