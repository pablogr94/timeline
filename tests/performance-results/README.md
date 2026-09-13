# Performance result artifacts

## Current reproducible result

`headless-stacking-cache.json` is the authoritative automated result for the cached-stacking implementation. It contains the full 20-case matrix, 180 frames per case, three runs per case, and SHA-256 fingerprints for both app source and benchmark source.

## Historical diagnostics

`headless-current.json` and `headed-current.json` were captured from the pre-cache implementation before source fingerprinting and repeated-run aggregation were added. They identify the Git commit but not the dirty working-tree source, so they are evidence from this development session—not independently reproducible baselines.

`headed-stacking-cache.json` is a reduced headed sample with 120 frames and three runs at 26, 250, and 1,000 items. It is useful confirmation of the scaling trend but must not be compared numerically with the 180-frame five-count headed baseline as if the configurations were identical.

Future before/after comparisons should use reports with matching mode, counts, scenarios, devices, frame count, run count, Chrome version, `appSourceSha256`, and `benchmarkSha256`. Headed runs must remain visible because Chrome may suspend animation frames when the window is minimized.
