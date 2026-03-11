# CLAUDE.md - Project Rules for Kit

## Project Overview
Kit is a $1 iOS flashcard app that imports Anki .apkg files and uses FSRS spaced repetition. Cat themed, haptics-first. Built with React/TypeScript/Vite wrapped in Capacitor for native iOS. Data lives on-device with iCloud Drive sync.

## Architecture Rules (NEVER VIOLATE)

### Separation of Concerns
- Components (`src/components/`) contain ONLY UI rendering logic
- Business logic lives in `src/lib/` (pure functions) and `src/hooks/`
- Database queries are ONLY in `src/lib/db/queries.ts`
- Native platform calls are ONLY in `src/lib/platform/`
- The apkg parser (`src/lib/apkg/`) must NOT import React or any UI code
- The FSRS engine (`src/lib/srs/`) must NOT import db, platform, or UI code
- The FSRS engine is PURE MATH - takes card state in, returns new state out

### TypeScript
- Strict mode ON. Never use `any`.
- All types in `src/types/`
- Every exported function has JSDoc with `@param` and `@returns`
- Discriminated unions for state machines
- `interface` for object shapes, `type` for unions/intersections

### Database
- Schema in `src/lib/db/schema.ts` as string constants
- ALL queries as functions in `src/lib/db/queries.ts`
- Typed params and typed results
- Parameterized queries only - never string interpolation
- Every write triggers iCloud sync (debounced 5min)

### Haptics
- Every state-changing interaction gets haptic feedback
- Card flip: medium impact
- Again: error pattern
- Hard/Good/Easy: success (escalating)
- Import complete: celebration
- Long-press edit: selection
- Undo: soft tap
- Route through `src/lib/platform/haptics.ts` only

### Error Handling
- Every async function uses try/catch
- Typed: `{ success: true, data: T } | { success: false, error: string }`
- Never swallow errors. User-friendly import error messages.

### File Naming
- Components: `PascalCase.tsx`
- Lib/hooks: `camelCase.ts`
- Types: `camelCase.ts`
- One component per file, one hook per file

### Testing
- FSRS engine and apkg parser have unit tests (Vitest)
- Test files next to source

### Dependencies (approved)
- sql.js, @capacitor-community/sqlite, jszip, konva, react-konva
- katex, uuid, @capacitor/share, @capacitor/filesystem, @capacitor/haptics

### Do NOT
- Use IndexedDB or localStorage
- Add deps without justification
- Put business logic in components
- Call Capacitor plugins from components directly
- Use class components or default exports (except pages)
- Write SQL outside db/queries.ts
- Import React in lib/srs/ or lib/apkg/
- Call haptics from components directly

## Key Decisions
- App name: Kit. 8-bit stray cat mascot, minimal black and white.
- Long-press to edit cards during study
- Dark/light theme toggle
- Export preserves edits for the pass-down workflow
- FSRS v4 with default parameters
- All dates Unix timestamps (seconds), all IDs UUID v4
