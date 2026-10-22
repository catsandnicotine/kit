# App Store Listing — Kit

Working draft. Pricing is undecided. This file is not published App Store metadata.

## App Name
Kit

## Subtitle (30 chars)
Flashcards. Focused practice.

## Description (4000 chars max)

Kit is a focused flashcard app for everyday study. Create your own cards or import an Anki deck, then practice with spaced repetition or review at your own pace.

BUILD A STUDY ROUTINE
Reveal an answer and rate how well you remembered it. Spaced repetition uses your responses to schedule future reviews, helping you spend time on cards that need more practice.

BRING YOUR CARDS
Import Anki .apkg files, including supported images, audio, formatting, and tags. Browse your cards, make edits, and organize your decks as your needs change.

STUDY AT YOUR OWN PACE
Use Study for scheduled practice, or switch to Practice to go through cards without changing your study schedule.

KEEP STUDYING OFFLINE
Study decks saved on your device without an internet connection. No Kit account is required.

KEEP YOUR WORK
Export decks to keep a copy or share them. Your cards remain portable as your study routine changes.

MAKE IT COMFORTABLE
Choose a light, dark, or OLED-black theme for your study sessions.

Kit is an independent app and is not affiliated with Anki. Importing a deck does not connect Kit to desktop Anki or AnkiWeb.

## Keywords (100 chars max)
flashcards,anki,spaced repetition,apkg,study,review,memorize,vocabulary,learning

## What's New (v1.0.1)
Initial release.

## App Store Review Notes

Kit can be used with the optional tutorial deck, a deck created in the app, or an imported Anki package. No external download or Kit account is required to try the app.

1. A fresh installation opens a skippable, unsaved demonstration. Tap the eye, then choose a rating. Select "Quick start" on the next page to add five tutorial cards. "Skip" goes directly to the setup choices.
2. Tap a deck to open it. Tap the eye or drag the card horizontally to reveal its answer. The two small paper-face controls return to the question and answer without advancing.
3. Scheduled studying uses Again, Hard, Good, or Easy. These ratings change the review schedule. Free Practice uses Again / Put aside and leaves the schedule unchanged.
4. In the library, swipe left to the second page for Practice and right to the first for scheduled studying. The two dots at the bottom are also accessible buttons; their accessibility labels identify each mode. There is no visible Study/Practice switch at the top.
   Practice's bottom-left Previous and bottom-right Next controls work on both card faces without revealing or rating. Navigation returns to the question; an occurrence's reveal count is not incremented by browsing. Previously chosen occurrences can be revisited without making the same choice again. On the finish screen Previous returns to the last card.
5. Select "Make cards" in setup or use + in the library. Name the deck, add text and/or media to each side, then Save. Press and hold a card while studying to offer "Edit this side"; choosing the offer opens the editor.
6. Select "Import Anki" and choose a supported .apkg file from Files. Kit is independent of Anki and does not connect to AnkiWeb.
7. The library's Settings control opens themes, study defaults, storage information, and bundled offline Support and Privacy pages.
8. Use a deck row's ··· control for Manage deck. Its Deck details ··· control contains restore-media and export actions. "Cards only" is a fresh rendered-card copy. "Cards & study history" additionally carries Kit scheduling/review history for reimport into Kit; it is not a universal Anki scheduling transfer or a complete backup of every Kit preference/count.
9. Optional art deck: tap the version number at the bottom of Settings seven times in quick succession. This opens "Jesus in Paintings", a bundled collection of paintings for art identification. Each card includes the painting title, museum attribution, date, recorded origin, source link, and image rights. Images work offline. This discovery gesture does not unlock purchases or change app functionality.

Notes for reviewers:
- Core studying works offline once a deck is saved on the device.
- The current build uses the user's own iCloud Drive when available; network access and an Apple account with iCloud Drive enabled are needed for cloud synchronization.
- Binary media (pictures/audio/video) is currently local to the importing device. Do not present cross-device media sync as a shipped feature.
- Imported JavaScript and inline script actions are not supported inside Kit. Standard hint disclosures and Kit's own image-occlusion rendering do not require executing imported scripts. Avoid promising add-on compatibility or universal Anki template support.
- Kit does not synchronize with desktop Anki or AnkiWeb.
- The current build has no ads, in-app purchases, or subscription prompts. Update this note if the business model changes.
- The optional art deck uses museum-designated CC0 images. Its bundled catalogue and image-rights evidence are in `public/decks/jesus-paintings/catalogue.json`. Historical Passion scenes include depictions of crucifixion. Account for that artwork when completing the content-rating questionnaire.

## Release checks before publishing

- Confirm the final price and business model in App Store Connect. The description intentionally contains no price or lifetime promise.
- Verify the public description against the final shipping build, including card creation, Practice mode, media import, and export.
- Complete two-device iCloud tests covering images, audio, offline reviews, reconnection, concurrent edits, and recovery before adding iCloud sync to the public feature list.
- Resolve the remaining sync protocol gaps before promising reliable concurrent use: delayed edits below the global watermark, cross-device Undo/suspension, and deletion/pending-upload cleanup. Checkpoints retain source edits rather than pruning them, but retention alone does not solve ordering or remote undo.
- Do not advertise Mac or Windows support until Kit is available and tested on those platforms.
- Test representative Anki packages and document compatibility limits. Do not claim support for every deck, template, add-on, or existing Anki study schedule.
- Confirm the privacy policy and App Store privacy answers match the shipping app.
- Publish and verify the public HTTPS support/privacy pages from `public/support.html` and `public/privacy.html` on the chosen support website. Bundled offline pages are available now; a local file is not an App Store Connect URL.
- Retest existing-user update preservation, failed imports/exports, clipboard/photo/video permissions, Files Open in, software keyboard and share handoff on iPhone. Never uninstall or clear a tester's app to deliver an update. An original Anki package is not a backup of subsequent Kit progress or edits.
- The native minimum and web build targets are iOS/Safari 16.4. Test the oldest supported OS and iPad portrait/landscape; browser resizing is not an older-iOS test. Do not claim accessibility support from labels alone: check VoiceOver, Larger Text and Reduce Motion in the shipping app.
- Build a new numbered Release archive, export with distribution signing, and run `npm run verify:ios-release -- /absolute/path/to/App.app --distribution`. The script checks local packaging only; App Store Connect validation and device tests remain separate.
- Complete/recheck age rating (including bundled artwork), encryption, pricing, availability, developer agreements and applicable territory declarations in App Store Connect. The export-encryption Info key now records the already-reviewed OS-only security implementation; reassess it if app encryption/dependencies change.
- Explain all gestures and the optional art deck in review notes; compare these instructions with the exact archive selected for review. Keep manual release selected until the owner chooses to publish.

Optional public copy after complete iCloud sync is verified:

"CONTINUE ON ANOTHER DEVICE
Keep your decks and study progress up to date across iPhone and iPad using your own iCloud Drive. Study saved decks offline; synchronization requires an internet connection."

## Screenshot Plan

Use Apple's current [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/) for the device families included in the release. Check the required iPhone and iPad sizes in App Store Connect before capture.

Capture these screens with sample study material:

1. Deck list — a small, clearly named collection of decks.
2. Study — a question with readable text and room for an image.
3. Study — the revealed answer with recall ratings visible.
4. Browse — cards organized with tags and search.
5. Practice or dark mode — show the actual interface without promotional overlays covering the controls.

Suggested captions:

1. "Your cards. Ready to study."
2. "Build a daily practice."
3. "Reveal. Recall. Review."
4. "Find and edit your cards."
5. "Study at your own pace."

Avoid claims such as "any Anki deck," "preserves everything," "most accurate," or "forever." Only show features available in the submitted build.
