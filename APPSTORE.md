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

Kit can be used with the included sample deck, a deck created in the app, or an imported Anki package. No external download or Kit account is required to try the app.

1. On a fresh installation, select "Try a sample deck" on the welcome screen.
2. Open the sample deck and tap a card to reveal its answer.
3. Rate your recall with Again, Hard, Good, or Easy in Study mode.
4. Return to the deck list, then use Practice mode to practice without changing the study schedule.
5. To test card creation, select "Create my own deck" on the welcome screen, or use the add control from the deck list.
6. To test importing, select "Import an Anki deck" and choose a supported .apkg file from Files.
7. Open Settings to try the available themes and study preferences.
8. Optional art deck: tap the version number at the bottom of Settings seven times in quick succession. This opens "Jesus in Paintings", a bundled collection of paintings for art identification. Each card includes the painting title, museum attribution, date, recorded origin, source link, and image rights. Images work offline. This discovery gesture does not unlock purchases or change app functionality.

Notes for reviewers:
- Core studying works offline once a deck is saved on the device.
- The current build uses the user's own iCloud Drive when available; network access and an Apple account with iCloud Drive enabled are needed for cloud synchronization.
- Kit does not synchronize with desktop Anki or AnkiWeb.
- The current build has no ads, in-app purchases, or subscription prompts. Update this note if the business model changes.
- The optional art deck uses museum-designated CC0 images. Its bundled catalogue and image-rights evidence are in `public/decks/jesus-paintings/catalogue.json`. Historical Passion scenes include depictions of crucifixion. Account for that artwork when completing the content-rating questionnaire.

## Release checks before publishing

- Confirm the final price and business model in App Store Connect. The description intentionally contains no price or lifetime promise.
- Verify the public description against the final shipping build, including card creation, Practice mode, media import, and export.
- Complete two-device iCloud tests covering images, audio, offline reviews, reconnection, concurrent edits, and recovery before adding iCloud sync to the public feature list.
- Do not advertise Mac or Windows support until Kit is available and tested on those platforms.
- Test representative Anki packages and document compatibility limits. Do not claim support for every deck, template, add-on, or existing Anki study schedule.
- Confirm the privacy policy and App Store privacy answers match the shipping app.

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
