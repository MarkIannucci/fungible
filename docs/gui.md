# Desktop GUI

The Electron desktop app shares the same `core/` logic and `~/.fungible/` data as the TUI. All ten screens are present (Dashboard, Transactions, Trends, Net Worth, Accounts, Tags, Rules, Health, Canvas, Settings) plus a chat drawer for the agent.

The GUI does **not** start the MCP or HTTP API servers in the background — if you want them running alongside the desktop app, launch them separately with `fungible mcp` or `fungible api`.

## Install

### From a release

Download an installer from the [latest GitHub Release](https://github.com/tomfunk/fungible/releases/latest):

- **macOS (Apple Silicon)** — `fungible-<version>-mac-arm64.dmg`
- **Windows (x64)** — `fungible-<version>-win-x64.exe`
- **Linux (x64)** — `fungible-<version>-linux-x86_64.AppImage` or `.deb`

The installers aren't code-signed. On first launch:

- **macOS** — Gatekeeper will block it. Open System Settings → Privacy & Security → "Open Anyway", or run `xattr -d com.apple.quarantine /Applications/Fungible.app` once.
- **Windows** — SmartScreen may warn; click "More info" → "Run anyway".
- **Linux AppImage** — `chmod +x` the file, then run it.

### From source

Requires Node.js 22+.

```bash
git clone https://github.com/tomfunk/fungible
cd fungible
npm install
npm run gui
```

For demo mode against an isolated dataset:

```bash
npm run gui:demo   # uses ~/.fungible-demo/
```

## Packaging locally

Builds installers for the current platform (or any platform — cross-compile works from macOS, with the usual caveats for code-signing):

```bash
npm run gui:dist:mac     # dmg + zip (arm64)
npm run gui:dist:win     # nsis installer (x64)
npm run gui:dist:linux   # AppImage + deb (x64)
```

Output lands in `release/`. Config is in `electron-builder.yml`. The libsql native binding is in `asarUnpack` so it can `dlopen` from disk; `@noble/hashes` is pinned via `overrides` because v2 went ESM-only and broke `app-builder-lib`'s CJS require.

## Release flow

Installers for tagged releases are built and attached automatically by `.github/workflows/release.yml` whenever something merges into `main`. The release flow is `feature → dev → main`; see [CONTRIBUTING.md](../CONTRIBUTING.md) for the branching policy.

## Data location

Same as the TUI: `~/.fungible/` (or `$FUNGIBLE_DATA_DIR` if set). The GUI reads and writes the same SQLite database, so you can switch between TUI and GUI freely without any data migration.
