import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
    aggregateMeasurements,
    buildFixture,
    closeBrowser,
    createFixtureSelector,
    parseBenchmarkOptions,
    percentile,
    removeUserDataDirectory,
    rootFromModuleUrl,
} from './performance-benchmark.mjs';

const sourceData = JSON.parse(
    fs.readFileSync(new URL('../data.json', import.meta.url), 'utf8'),
);

test('spread fixture deterministically fills the requested timeline range', () => {
    const first = buildFixture(sourceData, { count: 100, scenario: 'spread' });
    const second = buildFixture(sourceData, { count: 100, scenario: 'spread' });

    assert.equal(first.items.length, 100);
    assert.deepEqual(first, second);
    assert.equal(first.items[0].id, 'benchmark-spread-1');
    assert.ok(first.items.every(item => item.year >= 1800 && item.year <= 2100));
    assert.ok(new Set(first.items.map(item => item.year)).size > 50);
    assert.ok(first.items.every(item => item.image.startsWith('data:image/svg+xml,')));
});

test('dense fixture creates a deliberate same-year worst case', () => {
    const fixture = buildFixture(sourceData, { count: 250, scenario: 'dense' });
    const years = fixture.items.map(item => item.year);
    const denseCount = years.filter(year => year === 1950).length;

    assert.equal(fixture.items.length, 250);
    assert.ok(denseCount >= 125, `expected at least half the items at 1950, received ${denseCount}`);
});

test('percentile uses the nearest-rank value without mutating samples', () => {
    const samples = [5, 1, 4, 2, 3];

    assert.equal(percentile(samples, 0.95), 5);
    assert.deepEqual(samples, [5, 1, 4, 2, 3]);
});

test('benchmark options default to the agreed matrix and reject invalid values', () => {
    assert.deepEqual(parseBenchmarkOptions([]), {
        counts: [26, 100, 250, 500, 1000],
        scenarios: ['spread', 'dense'],
        devices: ['desktop', 'mobile'],
        headed: false,
        frames: 180,
        runs: 3,
        output: null,
        chromePath: null,
    });

    assert.throws(
        () => parseBenchmarkOptions(['--counts=26,nope']),
        /Invalid item count/,
    );
    assert.throws(
        () => parseBenchmarkOptions(['--scenarios=unknown']),
        /Invalid scenario/,
    );
    assert.equal(parseBenchmarkOptions(['--runs=5']).runs, 5);
    assert.throws(() => parseBenchmarkOptions(['--runs=0']), /Invalid run count/);
});

test('Chrome profile cleanup tolerates files that remain briefly locked', () => {
    let receivedOptions;
    removeUserDataDirectory('temporary-profile', (directory, options) => {
        assert.equal(directory, 'temporary-profile');
        receivedOptions = options;
    });

    assert.equal(receivedOptions.recursive, true);
    assert.equal(receivedOptions.force, true);
    assert.ok(receivedOptions.maxRetries >= 5);
    assert.ok(receivedOptions.retryDelay >= 100);
});

test('server fixture selection does not depend on the page referrer', () => {
    const fixtureSelector = createFixtureSelector(sourceData);

    fixtureSelector.select({ count: 100, scenario: 'dense' });
    const selected = fixtureSelector.buildCurrent();

    assert.equal(selected.items.length, 100);
    assert.ok(selected.items.filter(item => item.year === 1950).length >= 50);
});

test('benchmark asks the launched browser to close through CDP', async () => {
    const calls = [];
    const connection = {
        async send(method) {
            calls.push(method);
            if (method === 'SystemInfo.getProcessInfo') {
                return { processInfo: [{ type: 'browser', id: 1234 }] };
            }
        },
        close() { calls.push('connection.close'); },
    };

    const browserPid = await closeBrowser(9222, {
        fetchImpl: async url => {
            calls.push(url);
            return { async json() { return { webSocketDebuggerUrl: 'ws://browser' }; } };
        },
        connect: url => {
            calls.push(url);
            return connection;
        },
    });

    assert.deepEqual(calls, [
        'http://127.0.0.1:9222/json/version',
        'ws://browser',
        'SystemInfo.getProcessInfo',
        'Browser.close',
        'connection.close',
    ]);
    assert.equal(browserPid, 1234);
});

test('repeat measurements return every field from one actual median run', () => {
    const result = aggregateMeasurements([
        { frameDurations: [10, 10], updateDurations: [100, 100] },
        { frameDurations: [20, 20], updateDurations: [1, 1] },
        { frameDurations: [30, 30], updateDurations: [50, 50] },
    ]);

    assert.equal(result.frame.p95Ms, 20);
    assert.equal(result.stacking.p95Ms, 1);
    assert.equal(result.runs.length, 3);
});

test('repository root decoding supports Windows paths with spaces', () => {
    const root = rootFromModuleUrl('file:///C:/Timeline%20Project/tests/performance-benchmark.mjs');
    assert.equal(root, path.normalize('C:/Timeline Project'));
});

test('browser shutdown command has a bounded timeout', async () => {
    const connection = {
        async send(method) {
            if (method === 'SystemInfo.getProcessInfo') {
                return { processInfo: [{ type: 'browser', id: 1234 }] };
            }
            return new Promise(() => {});
        },
        close() {},
    };

    await assert.rejects(
        closeBrowser(9222, {
            timeoutMs: 10,
            fetchImpl: async () => ({ async json() { return { webSocketDebuggerUrl: 'ws://browser' }; } }),
            connect: () => connection,
        }),
        /Timed out closing Chrome/,
    );
});
