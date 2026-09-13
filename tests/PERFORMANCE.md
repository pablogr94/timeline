# Timeline performance benchmark

The benchmark runs the real Timeline renderer in installed Chrome with deterministic local SVG thumbnails. It measures controlled pan/zoom frames at 26, 100, 250, 500, and 1,000 items in both spread and dense same-year layouts.

## Run

```bash
node tests/performance-benchmark.mjs --headed --output=tests/performance-results/headed.json
```

Without `--headed`, Chrome runs headlessly. Each case defaults to 180 frames and three runs. The summary is the complete run whose frame-time p95 is the median of those runs, so its fields always describe one real measurement.

Keep a headed Chrome window visible while it runs. Browsers can suspend `requestAnimationFrame` when a window is minimized or fully occluded; the runner fails a stalled measurement after two minutes rather than hanging indefinitely.

Useful options:

```text
--counts=26,100,250,500,1000
--scenarios=spread,dense
--devices=desktop,mobile
--frames=180
--runs=3
--headed
--output=tests/performance-results/report.json
--chrome=C:/path/to/chrome.exe
```

For a quick browser interaction regression while the app is served at `http://127.0.0.1:8000`:

```bash
node tests/browser-regression.mjs
```

## Reading the report

- `frame.p95Ms`: 95% of measured animation-frame intervals were at or below this duration.
- `stacking.p95Ms`: 95% of measured camera/layout updates were at or below this duration.
- `framesOver33_3Percent`: proportion of frames slower than roughly 30 fps.
- `runs`: the individual summaries used to calculate the median result.
- `appSourceSha256` and `benchmarkSha256`: exact fingerprints required for trustworthy comparisons of dirty working trees.

The mobile preset is Chrome device emulation, not a physical-phone measurement. The fixture isolates renderer/layout scaling and deliberately removes network variability; it does not measure production image-download cost, decoding of large photographs, or real mobile GPU performance.
