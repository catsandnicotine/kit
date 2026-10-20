# Kit

Kit is an offline-first iOS flashcard app for studying Anki decks with FSRS. It is built with React, TypeScript, Vite, sql.js, and Capacitor, with optional file-level sync through the user's own iCloud Drive.

## What it supports

- Import and export of Anki `.apkg` decks
- FSRS v4 scheduling with configurable learning steps and retention
- Images, audio, KaTeX, custom Anki templates, and image occlusion
- Card creation and editing, deck settings, statistics, tags, and search
- A consequence-free Review mode alongside scheduled Learn mode
- Per-deck local databases with edit-log compaction and optional iCloud sync
- Light, dark, and OLED-black themes; native haptics and iOS safe-area layouts

## Local development

Requirements: Node.js 20 or newer, npm, and Xcode 16 or newer for iOS work.

```bash
npm install
npm run dev
```

The browser build uses `localStorage` as a development-only stand-in for the native filesystem and iCloud. Production data on iOS is stored on-device through Capacitor, with iCloud used only when available.

## Quality checks

Run the complete local gate before shipping:

```bash
npm run check
```

This runs ESLint, the Vitest suite, TypeScript, and the Vite production build. Individual commands are also available as `npm run lint`, `npm test`, and `npm run build`.

## iOS

### Test the bundled app on an iPhone

Connect the iPhone by cable, unlock it, accept the trust prompt, and enable Developer Mode under **Settings → Privacy & Security → Developer Mode**. Then run:

```bash
npm run check
npm run sync:ios
open ios/App/App.xcodeproj
```

In Xcode, select the **App** target, confirm the development team under **Signing & Capabilities**, choose the connected iPhone as the run destination, and press **Run** (`⌘R`). Automatic signing is enabled for `com.kai.kit`; Xcode may refresh the development profile the first time a new phone is used.

### Live reload on an iPhone

Keep the Mac and iPhone on the same Wi-Fi network. In one terminal, expose Vite to the LAN:

```bash
npm run dev -- --host 0.0.0.0
```

Find the Mac's Wi-Fi address with `ipconfig getifaddr en0` (or in System Settings → Network). In a second terminal, substitute that address below and synchronize the explicit development URL:

```bash
CAP_DEV_URL=http://192.168.1.42:5173 npm run sync:ios
```

Run the app from Xcode again and accept the local-network prompt on the iPhone. Native Swift or Capacitor changes still require another Xcode build.

`CAP_DEV_URL` is opt-in; a normal sync uses bundled production assets. Before archiving or making a release build, ensure it is unset and resynchronize:

```bash
unset CAP_DEV_URL
npm run sync:ios
```

Signing, capabilities, the iCloud container, the deployment target, and the release version are managed in Xcode. Use `npm run sync:ios`, rather than raw `npx cap sync ios`, so Kit's custom iCloud plugins remain registered.

## Architecture

- `src/components/` — rendering-only UI components
- `src/hooks/` — application and interaction state
- `src/lib/db/` — schema, migrations, and all SQL queries
- `src/lib/srs/` — pure FSRS scheduling logic
- `src/lib/apkg/` — Anki parsing, rendering, and export
- `src/lib/sync/` — edit logs, replay, compaction, and deck registry
- `src/lib/platform/` — Capacitor/native and browser adapters
- `ios/` — native Capacitor application and iCloud plugins

Project constraints and conventions are documented in `claude.md`. App Store copy, reviewer instructions, and the screenshot plan are in `APPSTORE.md`.

## Privacy

Kit does not require an account and has no application server. Decks stay on the device unless the user enables syncing through their personal iCloud Drive. The user-facing privacy policy is in `public/privacy.html`.
