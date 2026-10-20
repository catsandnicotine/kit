# CLAUDE.md - Project Rules for Kit

## Project Overview
Kit is a focused iOS flashcard app that imports Anki .apkg files and uses FSRS spaced repetition. Pricing is undecided. Built with React/TypeScript/Vite wrapped in Capacitor for native iOS. Data lives on-device with iCloud Drive sync.

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
- Keep routine interactions light; coalesce duplicate pulses and cancel unfinished patterns on the next interaction. No startup vibration.
- Card flip: light click
- Again: gentle two-pulse return, never an error alarm
- Hard: weighted single knock; Good: light confirmation; Easy: spaced light double tick
- Start rating haptics with the pixel animation, not after saving. Never escalate based on recall streaks.
- Actual session/import completion: native success cadence; no celebration for an initially empty session
- Long-press edit: light activation
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
- App name: Kit. Text wordmark, quiet UI, and original pixel artwork for study actions.
- Long-press to edit cards during study
- Dark/light theme toggle
- Export preserves edits for the pass-down workflow
- FSRS v4 with default parameters
- All dates Unix timestamps (seconds), all IDs UUID v4

## Current Visual Direction
- No faint grey outlines around dark buttons, settings groups, or selected tiles.
- Use spacing, solid fills, typography, and checkmarks to group controls and show selection.
- Avoid nested button frames. Recall controls use their pixel icons directly.
- Keep meaningful keyboard focus indicators and content-specific marks such as diagram masks.
- Pixel-art feedback changes the drawings frame by frame, with highlights that follow the material. Do not rotate or scale a fixed icon as its animation.
- Keep recall feedback brief (180 ms), play it only on interaction, and respect Reduce Motion.
- Current art references: Terraria's compact item silhouettes, Metal Slug's expressive sprite work, and Apple's restraint in interface motion. The eye uses spaced rays above and below.

- Pigment direction: preserve the blue/red/green semantic colour roles. Explore vibrant lapis, vermilion, emerald, warm ivory and restrained gold, inspired by Catholic painting, early painted tarot, and California light. Concentrated symbolic meaning and original artwork; avoid decorating every control. The emerald Aureole eye is the production choice, with sparse, short platinum marks forming an oval and a small serif italic “see” beneath. Halo and lettering alternatives live in the developer art study.
- Session progress measures distinct cards cleared from the active queue. Queued repeats remain unfinished; never label this as long-term mastery. Show exact done/total and cards left, without a redundant percentage or invented completion-time estimate.

## Parked Product Ideas
- Revisit deck creation in a later design conversation: explicit camera and photo-library entry, text/photo/mixed fronts and backs, reliable Anki import, and other creation routes justified by actual user pain points.
- Explore an optional layout with space for iOS Picture in Picture while studying. Check YouTube/device availability and public iOS APIs before promising a fixed cutout or automatic detection.
- These ideas were parked at the user's request while the current visual pass is finished.

## Media and Deck Menus
- Imported media must live outside temporary per-deck import databases: native Documents/media files, browser origin-private filesystem files. JSON snapshots do not carry binary media. Cross-device media sync remains incomplete; do not claim it is fixed by local storage repairs.
- Route a shared imported asset to every deck whose rendered cards reference it; preserve original filename spelling and encode native URL path components.
- Existing decks can restore media from their original Anki package through Edit deck → Restore pictures & audio. Never replace cards, schedules, or review logs during media restoration.
- Deck names stay on one line. Hold or context-click to reveal/select the full name. Format legacy Anki hierarchy separators for display without rewriting stored names.
- Deck actions are a compact list; Rename/Cover/Restore live under Edit deck, and export choices live under Share. No outlined tile grid.

## Path and Copy Direction
- Visible modes are Study (scheduled cards) and Practice (no scheduling writes). Internal mode/route identifiers remain unchanged.
- Completion has Done and optional Keep practising. Free practice completion exits to the library; Back during practice can return to the study finish. Do not reintroduce the early-review quantity picker or a hidden limit picker on queue counters.
- Use small 17px utility icons with 44px touch targets and accessible action names. Keep short labels for recall ratings, modes, destructive actions, and ambiguous choices.
- Front/Back image controls live beside their fields. Attachment details are collapsed. First-card saving shows a nonblocking Study action, not another modal.
- Guard dirty-editor dismissal with a focused native confirmation. Keep deletion/replacement consequences explicit. Never promise a verified iCloud copy without evidence.
- Daily limits lead in deck settings; advanced learning and scheduling controls are collapsed with help on request.
- Tag pickers show eight everyday colours while preserving the current imported/custom shade. Keep historical colour metadata for sorting.
- Privacy opens the bundled policy inside Settings with a Back action, including offline. Keep its statements consistent with local media storage and user-initiated exports.
- design/flow-audit.html records the reviewed paths and per-path verification limits. Browser checks do not establish iOS permission, VoiceOver, file-handoff, or multi-device sync coverage.

## Study history and statistics audit (2026-10-19)
- The row pencil edits cards. The overflow submenu is called Deck details (rename, cover, restore media), avoiding a second ambiguous Edit deck label.
- Statistics derives from real local review_logs. Recall rate means the share of scheduled ratings other than Again, including learning attempts; it is not demonstrated long-term retention or mastery. Practice is excluded.
- Deck charts use local calendar days, including daylight-saving transitions. Yesterday’s streak stays alive before today’s first review. Learning state totals include future steps.
- Review logs already preserve card ID, rating, timestamp, elapsed DAYS since the previous review, and scheduled interval; these are replayed/snapshotted through the existing sync system. The elapsed column is not response time.
- Free practice currently makes no history writes. Active study duration, front/back response times, session IDs, and historical scheduler versions are not persistently recorded. Do not infer or fabricate these later from the current logs.
- Preserve purposeful study records in the user’s storage; do not add server telemetry, content uploads, or “collect everything” tracking as speculative feature preparation. Any future practice/duration events need explicit semantics and must remain distinct from scheduling reviews so they cannot change FSRS or inflate recall statistics.

## Open user requests (2026-10-19 visual pass)
- Card-side cue: two small outlined faces, active 1/2 highlighted, with Question/Answer beside them; no outline around the whole study area. Shared across Study and both Practice routes.
- Eye halo: nearly round but slightly wider than tall, visibly rounder than the eye; maintain platinum, sparse pixel marks, italic see.
- Still open: comprehensive physical-device flash/jank verification; broader Anki/media compatibility; full cross-device images/audio and offline/concurrent-edit/recovery verification; explicit camera-first creation (photo attachment already exists); app-wide visual consolidation; full code-simplicity audit; Mac/PC delivery; competitor/pricing and fair monetization decisions; final App Store copy, screenshots, TestFlight and submission.
- Intentionally parked: PiP-friendly study layout. Persistent active study duration/practice history was discussed as a future foundation, not implemented.
- Prioritize deck/media reliability and complete sync before expanding optional features or claiming release readiness.

- Eye invitation now reads “Click 2 see” in the shared italic serif. Its front-face idle loop combines a two-screen-pixel vertical drift, a slow restrained radial ray breath, and six low-opacity authored pixel-light exposures over lid/iris/lid every 2.8 seconds. No idle haptics. Disable all idle animation and glints for Reduce Motion. The developer art board offers explicit Play/Pause for motion inspection without changing the device preference.

- Question/reveal layout: keep front content in a bounded independently scrollable viewport, with a consistent gap before the reveal zone. Use viewport-responsive default text sizing and a readable content width while retaining imported markup. Reveal includes a small turn arrow under the eye. On short landscape windows, place the reveal zone beside the question so long prompts retain usable scrolling height; portrait keeps the lower eye beneath it.

- Recall pigment refinement from the user’s supplied painting reference: Again is deep warm crimson rather than copper/orange; Hard is muted ink-blue steel rather than icy bright blue. Keep narrow ivory highlights for legibility on black. These palettes apply to all authored animation frames. The before/after board is design/pigment-study.html.

- Again silhouette refinement (2026-10-20): continuous curved band, tangential smaller arrowhead, consistent thickness and one lighting direction. Keep crimson palette. All eight feedback drawings follow the revised geometry and finish on the exact rest drawing; total 240 ms. Compare old/new shapes at design/arrow-study.html. This is distinct from the small flip ribbon below the eye.

- Again depth refinement: retain its current curve and crimson palette, with a small lower-right extrusion painted into the sprite, a brighter top face, and a continuous shaded side. Apply the same construction to every pose; do not substitute a CSS shadow for the dimensional drawing.

- Again red correction from the supplied painting screenshot: remove pink/salmon highlight dominance and plum shadows. Use an earthy warm red face (#8f2924), red-ochre highlight (#a74635), and brown-red shaded side (#5d211c), with sparse warm specular accents. Reference screenshot red pixels were sampled for hue/value guidance; the small-screen palette is adapted for legibility, not claimed as a colour-managed reproduction. Preserve the current 3D geometry.

- User clarified that the Again ribbon should actually turn over (a visible half-twist), not merely gain extrusion. Three unshipped pixel sketches are in design/ribbon-study.html: lower half-twist, side half-twist, and a sharp fold. Production keeps the existing warm-red 3D arrow until a construction is selected; its animation must be redrawn to match any selected geometry.

- Ribbon sketches now have a gently uneven loop and asymmetric arrowhead, with light ivory, restrained gold and grey-green reflected accents in addition to the warm red. Palette additions remain in the developer concepts, not production, while the half-twist construction is being chosen. The first lower-turn variant is the current suggested direction.

## Satin material clarification (2026-10-20)
- User explicitly chose SATIN for the Again arrow-ribbon. Prior solid/extruded and generic ribbon sketches did not establish the intended material. Stop treating extra edge thickness or scattered pale pixels as sufficient material definition.
- Study real thin satin edges, broad shifting reflections across a folded face, deep self-shadow, and one continuous soft half-turn. Retain a slightly lopsided silhouette, warm painting-red body, and restrained ivory/gold/cool reflected accents, while preserving the arrow's small-size readability.
- Actual references visually inspected: Fabric and Ribbon's blue Berisfords satin loop photograph (https://www.fabricandribbon.co.uk/cdn/shop/files/Satin-DRBlue-3501-10-243-4_80833501-1550-49e4-95ed-fc1ffa03f9b3_1024x1024.jpg?v=1712071714) and ETOKA's green satin half-turn demonstration (https://ameblo.jp/cbc18487/entry-12788575860.html). Reference colours are not the arrow palette. Do not claim the historical-art searches were visually studied in this turn.
- design/satin-study.html shows an unshipped material study alongside these references. It remains a study, not accepted production art or a completed animation. Production still uses the previous warm-red solid arrow until the satin drawing is resolved.

- Latest colour steering: user rejected the earthy painting-derived red as muddy/brown and asked about Apple's colour direction. Do not keep treating the sampled painting red as accepted. The satin study now compares the previous earth red, a clean Apple-inspired coral (suggested), and a deeper saturated ruby using identical geometry on light/dark grounds. These are custom sprite palette studies, not native dynamic system colours; neither satin nor the brighter palette is shipped yet.

- Satin readability correction: user said the material study no longer read as an arrow. Restore a clearly left-pointing arrowhead with an open return-loop silhouette; confine the half-turn to a short lower section. Preserve satin light, slight asymmetry, and the clean coral/ruby colour studies. This correction is in the unshipped satin study; arrow recognition at 64px takes priority over decorative ribbon detail.

## Accepted coral satin arrow (2026-10-20)
- User approved coral after the clear-arrowhead satin preview. Coral satin Again is now production artwork in src/components/art/againArt.ts, shared by Study and Practice. It retains a clear left-pointing head, a slightly uneven open loop, one short half-turn and restrained warm/cool reflections.
- Rest and all eight feedback poses are 32×32; the renderer derives viewBox height from the artwork to avoid cropping the new sprite while preserving other symbols' aspect ratios. Feedback is a small free-end fabric tug followed by a travelling sheen, 240 ms total, ending exactly on the resting drawing. Respect existing Reduce Motion and haptic behaviour.
- This acceptance supersedes earlier notes that the satin/coral drawing was unshipped. Brown/earth-red versions and alternative ribbon constructions remain historical studies.

- Coral satin arrowhead refinement: user asked for a fuller top/head and a slight downward angle toward the ribbon's free end, so the open loop feels more complete. Apply that enlarged, tilted head consistently to rest and all eight poses; retain a clear gap and the accepted coral satin palette.

- Coral satin loose-end refinement: extend the free end slightly and shift the short half-turn toward the right of the lower curve. Preserve the enlarged downward-tilted head, open gap, palette, and 240 ms eight-pose animation.

- Recall timing refinement (2026-10-20): all four rating sequences and Practice choices now last 180 ms, superseding earlier 240 ms notes. Each material keeps its own eight-pose rhythm. Again has a local free-end cloth ripple that travels into its half-turn, with the satin reflection following the fold; upper bow/head stay still and final pose exactly matches rest. Choice feedback begins immediately and gates the next card for 180 ms; local review writes follow that beat. Reduce Motion skips this deliberate wait, and eye idle motion never gates answer reveal.

- Satin tail width: after the half-turn the cloth opens back out to a broad, even-width end rather than looking tapered or narrower than the upper band. The tail is slightly fuller again and the half-turn sits farther into the lower-right curve. Carry that fullness and fold placement through all eight 180 ms feedback poses.

- Latest Again palette refinement: shift the approved coral slightly toward a clear warm red (#f43b32), with warm coral highlights and red shadows rather than ruby/plum. Preserve the accepted fuller tail, lower-right half-turn, and all eight 180 ms drawings. This supersedes the coral-only palette direction.
