# Jesus in Paintings

This optional Kit deck uses museum-designated CC0 images. Discover it with seven consecutive taps on the version at the bottom of Settings. Repeating the gesture opens the existing deck without replacing its cards or study progress. The discovery gesture is also documented in the App Store review notes.

The current bundle contains 157 painting records: 104 from the Cleveland Museum of Art and 53 from The Metropolitan Museum of Art. All bundled images work offline. The collection covers infancy and narrative scenes as well as portraits of Christ. Separate museum records can describe a complete altarpiece and its individual painted panels.

## Scope and evidence

This is a documented collection, not a worldwide census of every painting of Jesus. `records.json` preserves the collected candidate records. The shipped `public/decks/jesus-paintings/catalogue.json` records inclusion, rights evidence, source URLs, search coverage, and exclusions. `checksums.json` identifies the actual bundled JPEGs. Titles, attribution uncertainty, and provenance come from museum records. Cultural attribution is labelled separately from a documented place of creation. Missing information stays unspecified.

- [Cleveland open access](https://www.clevelandart.org/open-access) and [API documentation](https://openaccess-api.clevelandart.org/)
- [Met image policy](https://www.metmuseum.org/policies/image-resources) and [collection API](https://metmuseum.github.io/)
- [Chicago API and image-download guidance](https://api.artic.edu/docs/)

Chicago's public-domain painting metadata was enumerated in disjoint ID ranges, covering all 1,965 records returned during collection. Every page of the recorded Cleveland subject searches was collected. Met results combine Jesus subject tags and painting-title searches. The Met returned 403 errors for many object records, and Chicago's image host blocked downloads. These unavailable records and images are explicitly excluded. No rights are inferred from the title, artist's age, or the existence of an image online.

The collection does not include modern copyrighted images, speculative reconstructions, or AI-generated paintings. JPEGs retain the source image's proportions and have a maximum long edge of 1,200 pixels. Card images use bare filenames so standard Anki exports include the actual image bytes. Bundled fallback is limited to the stable built-in deck ID and an allowlist of downloaded files, leaving user-supplied media first priority.

## Rebuild

Use Node 20+ with network access on macOS. The downloader uses the system `sips` tool to resize JPEGs. No extra application dependency is required.

```sh
node scripts/jesus-paintings/collect.mjs
node scripts/jesus-paintings/download.mjs
npm run check
```

The collector resumes from cached public API responses in `/tmp/kit-jesus-catalogue`. Set `KIT_ART_CACHE` to choose a persistent cache directory. It stops new Met requests after repeated 403 responses, while retaining cached records. Previously unavailable images remain excluded on routine runs. When the museum image service becomes available, explicitly retry them with:

```sh
node scripts/jesus-paintings/download.mjs --retry-unavailable
```

Review newly added subjects, add unrelated matches to `exclusions.json`, inspect the images, and rerun the downloader. Keep the checked date and coverage accurate when refreshing the collection. The script does not publish or deploy anything.
