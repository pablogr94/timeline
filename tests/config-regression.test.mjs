import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function createStyle() {
    return {
        setProperty() {},
    };
}

function loadTimelineRuntime() {
    const element = {
        addEventListener() {},
        appendChild() {},
        classList: {
            add() {},
            contains() { return false; },
            remove() {},
            toggle() {},
        },
        querySelector() { return null; },
        style: createStyle(),
    };

    const context = {
        console,
        document: {
            body: element,
            createElement() { return { ...element, style: createStyle() }; },
            documentElement: { style: createStyle() },
            getElementById() { return element; },
            querySelector() { return null; },
            querySelectorAll() { return []; },
        },
        fetch() { return new Promise(() => {}); },
        getComputedStyle() {
            return {
                getPropertyValue(name) {
                    return name === '--motion-card-expand' ? '0.4s' : '';
                },
            };
        },
        requestAnimationFrame() {},
        setTimeout() {},
    };

    context.window = {
        addEventListener() {},
        innerHeight: 900,
        innerWidth: 1440,
        matchMedia() { return { matches: false }; },
    };
    context.globalThis = context;

    const source = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'script.js' });
    return { config: context.window.TIMELINE_CONFIG, context, source, window: context.window };
}

function readRootVariables() {
    const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const rootBlock = css.match(/:root\s*{([\s\S]*?)}/)?.[1] ?? '';
    return Object.fromEntries(
        [...rootBlock.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
            .map(([, name, value]) => [name, value.trim()]),
    );
}

function getLeafKeys(value) {
    return Object.entries(value).flatMap(([key, child]) => {
        if (child && typeof child === 'object') return getLeafKeys(child);
        return [key];
    });
}

function isDeeplyFrozen(value) {
    return Object.isFrozen(value)
        && Object.values(value).every(child => !child || typeof child !== 'object' || isDeeplyFrozen(child));
}

test('central JavaScript config preserves and connects the current behavior values', () => {
    const { config, context, source, window } = loadTimelineRuntime();

    assert.ok(config, 'window.TIMELINE_CONFIG should expose the central configuration');
    assert.deepEqual(
        JSON.parse(JSON.stringify(config.timeline)),
        { minYear: 1800, maxYear: 2100, pixelsPerYear: 500, initialYear: 1950 },
    );
    assert.equal(config.camera.minScale, 0.02);
    assert.equal(config.camera.maxScale, 1.5);
    assert.equal(config.camera.baseGlideSpeed, 0.4);
    assert.equal(config.detail.itemZoomMultiplier, 1.5);
    assert.equal(config.image.maxConcurrentLoads, 3);
    assert.equal(config.touch.friction, 0.95);
    assert.ok(isDeeplyFrozen(config), 'the inspection config should not imply live runtime editing');
    const descriptor = Object.getOwnPropertyDescriptor(window, 'TIMELINE_CONFIG');
    assert.equal(descriptor.writable, false, 'the inspection config cannot be replaced');
    assert.equal(descriptor.configurable, false, 'the inspection config cannot be redefined');
    assert.equal(config.mobileCard.originalRevealDelayMs, undefined);
    assert.equal(config.mobileCard.cloneRemovalDelayMs, undefined);

    for (const key of getLeafKeys(config)) {
        const occurrences = source.match(new RegExp(`\\b${key}\\b`, 'g'))?.length ?? 0;
        assert.ok(occurrences >= 2, `${key} should be defined and connected to a consumer`);
    }

    assert.match(source, /getCssTimeMs\('--motion-card-expand'\)/);
    assert.match(source, /cloneTransitionMs\s*\/\s*2/);
    assert.equal(vm.runInContext("getCssTimeMs('--motion-card-expand')", context), 400);
});

test('CSS exposes and uses the main art-direction controls', () => {
    const variables = readRootVariables();
    const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

    assert.equal(variables['--base-item-height'], '100px');
    assert.equal(variables['--canvas-color'], '#b0b0b0');
    assert.equal(variables['--context-card-width'], '220px');
    assert.equal(variables['--motion-card-position'], '0.85s');
    assert.equal(variables['--context-title-color'], '#555555');

    for (const name of Object.keys(variables)) {
        assert.ok(css.includes(`var(${name})`), `${name} should be used`);
    }

    assert.match(css, /width:\s*calc\(100% \+ \(2 \* var\(--context-card-padding-x\)\)\)/);
    assert.match(css, /margin-top:\s*calc\(-1 \* var\(--context-card-padding-y\)\)/);
    assert.match(css, /margin-left:\s*calc\(-1 \* var\(--context-card-padding-x\)\)/);
    assert.match(css, /margin-right:\s*calc\(-1 \* var\(--context-card-padding-x\)\)/);
    assert.match(css, /body::before\s*{[\s\S]*?transition:\s*opacity var\(--motion-card-expand\)/);
});
