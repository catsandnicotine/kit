# App Store Listing — Kit

## App Name
Kit

## Subtitle (30 chars)
Study smarter. $1. No subs.

## Description (4000 chars max)

Kit is a flashcard app built for people who take learning seriously. It imports Anki .apkg files — the most widely-used flashcard format — and studies them using the FSRS algorithm, the most accurate spaced repetition system available today.

**$1. One time. No subscription.**

AnkiMobile costs $25. Flashcard apps with subscriptions cost $5–15 per month. Kit is $1, forever.

---

**Import any Anki deck**

Thousands of free Anki decks exist for medicine, law, languages, history, and more. USMLE Step 1, Anki's 10,000-card medical school decks, language vocabulary sets — Kit imports them all. Drop in your .apkg file and you're studying in seconds.

Kit preserves everything: images, audio, image occlusion cards, custom card styling, and your existing tag structure.

---

**FSRS — smarter scheduling**

Kit uses FSRS v4, a modern spaced repetition algorithm that outperforms the classic Anki algorithm (SM-2) on every benchmark. It models your actual memory, adjusting intervals based on how reliably you recall each card rather than applying a fixed multiplier.

Rate cards Again, Hard, Good, or Easy. FSRS calculates exactly when each card should come back to maximize retention while minimizing time spent reviewing.

---

**Fully offline. No account needed.**

Kit stores everything on your device. There are no servers, no accounts, no login, and no internet connection required — ever. Your flashcard data is yours.

---

**iCloud sync**

Enable iCloud in Settings and your decks sync automatically across all your iPhone and iPad devices through your own iCloud Drive account. Kit never touches your data — it's stored in your personal iCloud.

---

**Edit cards. Pass them down.**

Long-press any card during study to edit it. Fix a typo, add a note, correct a diagram. When you export a deck, Kit embeds your edits and your study progress so you can pass the deck to a friend or re-import it later without starting from scratch.

---

**Review mode**

Not in the mood to grind? Switch to Review mode for a no-pressure pass through your cards — shuffle them, send ones you don't know to the back, and set aside ones you've nailed. Nothing is saved to your progress.

---

**Image occlusion**

Kit renders image occlusion cards from Anki natively — the colored masks over anatomy diagrams, maps, and charts that hide the answer until you flip.

---

**Who it's for**

Kit is for medical students grinding Step 1, language learners working through 5,000-word vocabulary decks, law students, history nerds, and anyone who needs to actually remember what they're studying — not just review it.

If you already have Anki decks on your computer, you have everything you need to start. Export from Anki, import into Kit, and study.

---

$1. One time.

## Keywords (100 chars max)
anki,flashcards,spaced repetition,apkg,medical,study,FSRS,cards,review,memorize

## What's New (v1.0.0)
Initial release.

## App Store Review Notes

**How to test the app:**

Kit requires an Anki .apkg file to function. A sample deck is available here for review purposes:
https://github.com/ankitects/anki/raw/main/pylib/tests/support/test.apkg

1. Download the sample .apkg file to an iOS device or use Files app to locate it.
2. Open Kit → tap the + button → select the .apkg file.
3. The deck will import (a few seconds). Tap the deck to begin studying.
4. Rate cards using Again / Hard / Good / Easy.
5. After rating, tap the back arrow to return home.
6. Settings are accessible via the gear icon: theme, study preferences, iCloud backup.

**Notes for reviewers:**
- No account or login is required at any point.
- No network connection is needed after installation.
- iCloud sync is optional and uses the reviewer's own iCloud Drive account.
- The app contains no ads, no in-app purchases, and no subscription prompts.

## Screenshot Plan

### Required sizes
- **6.7" (iPhone 16 Pro Max / 15 Pro Max)** — 1320 × 2868 px
- **6.5" (iPhone 11 Pro Max / XS Max)** — 1242 × 2688 px
- **iPad Pro 13" (M4)** — if submitting for iPad

### Screens to capture (in order)

1. **Home screen** — 2–3 decks visible, card counts showing, FAB visible
2. **Study — front** — mid-card, clean layout, deck name in header
3. **Study — back** — answer revealed, Again/Hard/Good/Easy buttons visible
4. **Tag browser** — tags listed with color dots
5. **Dark mode** — home screen or study screen in dark mode

### Simulator setup
```
xed ios/App/App.xcodeproj
# Product > Destination > iPhone 16 Pro Max (or 15 Pro Max)
# Run in simulator
# Device > Screenshot (Cmd+S) or use Simulator > File > Save Screen
```

### Framing
Consider using Apple's device frames or a tool like AppMockUp / Rottenwood for framed screenshots with caption text on a colored background. Suggested caption copy:

1. "Your Anki decks. On iPhone."
2. "Study smarter with FSRS"
3. "See the answer. Rate your recall."
4. "Organize by tag"
5. "Dark mode. Offline. Always."
