import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function createStyle() {
    const properties = new Map();
    return {
        properties,
        setProperty(name, value) { properties.set(name, String(value)); },
    };
}

function loadRuntime() {
    const animationFrames = [];
    const windowListeners = new Map();
    const baseElement = {
        addEventListener() {},
        appendChild() {},
        classList: {
            add() {},
            contains() { return false; },
            remove() {},
        },
        style: createStyle(),
    };
    const context = {
        console,
        document: {
            body: baseElement,
            createElement() { return { ...baseElement, style: createStyle() }; },
            documentElement: { style: createStyle() },
            getElementById() { return baseElement; },
            querySelectorAll() { return []; },
        },
        fetch() { return new Promise(() => {}); },
        getComputedStyle() { return { getPropertyValue() { return ''; } }; },
        requestAnimationFrame(callback) {
            if (callback) animationFrames.push(callback);
        },
        setTimeout() {},
    };
    context.window = {
        addEventListener(name, callback) { windowListeners.set(name, callback); },
        innerHeight: 900,
        innerWidth: 1440,
        matchMedia() { return { matches: false }; },
    };
    context.animationFrames = animationFrames;
    context.windowListeners = windowListeners;
    context.globalThis = context;

    const source = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'script.js' });
    return context;
}

function createItem(year, width, priority = 2) {
    let measuredWidth = width;
    let widthReads = 0;
    const style = createStyle();
    const element = { style };
    Object.defineProperty(element, 'offsetWidth', {
        get() {
            widthReads++;
            return measuredWidth;
        },
    });
    return {
        baseX: (year - 1800) * 500,
        element,
        priority,
        style,
        year,
        set width(value) { measuredWidth = value; },
        get widthReads() { return widthReads; },
    };
}

test('camera updates reuse measured widths and cached lane assignments', () => {
    const context = loadRuntime();
    const items = [
        createItem(1900, 160, 1),
        createItem(1900, 140),
        createItem(1901, 180),
    ];
    context.testItems = items;

    vm.runInContext('loadedItems = testItems; rebuildStackingLayout()', context);
    assert.deepEqual(items.map(item => item.widthReads), [1, 1, 1]);
    assert.ok(items.every(item => Number.isInteger(item.laneOffset)));
    assert.deepEqual(items.map(item => item.sameYearCount), [0, 1, 0]);

    vm.runInContext('scale = 0.5; updateVerticalStacking(); updateVerticalStacking()', context);

    assert.deepEqual(items.map(item => item.widthReads), [1, 1, 1]);
    assert.equal(items[1].style.top, 'calc(-200px * var(--inv-scale, 1))');
});

test('static horizontal position and z-index are assigned during rebuild only', () => {
    const context = loadRuntime();
    const item = createItem(1900, 160, 1);
    context.testItems = [item];

    vm.runInContext('loadedItems = testItems; rebuildStackingLayout()', context);
    const left = item.style.left;
    const zIndex = item.style.zIndex;

    vm.runInContext('scale = 0.3; updateVerticalStacking()', context);

    assert.equal(item.style.left, left);
    assert.equal(item.style.zIndex, zIndex);
    assert.equal(left, '50000px');
    assert.equal(zIndex, 500);
});

test('same-frame image loads schedule one rebuild using settled widths', () => {
    const context = loadRuntime();
    context.animationFrames.length = 0;
    const item = createItem(1900, 100);
    context.testItems = [item];
    vm.runInContext('loadedItems = testItems; rebuildStackingLayout()', context);

    item.width = 220;
    vm.runInContext('scheduleStackingLayoutRebuild(); scheduleStackingLayoutRebuild(); scheduleStackingLayoutRebuild()', context);
    assert.equal(context.animationFrames.length, 1);

    context.animationFrames.shift()();
    assert.equal(item.widthReads, 2);
    assert.equal(vm.runInContext('stackingLayoutRebuildQueued', context), false);
});

test('viewport resizing invalidates cached card dimensions', () => {
    const context = loadRuntime();
    context.animationFrames.length = 0;
    const item = createItem(1900, 100);
    context.testItems = [item];
    vm.runInContext('loadedItems = testItems; rebuildStackingLayout()', context);

    context.windowListeners.get('resize')();
    assert.equal(context.animationFrames.length, 1);
});

test('major-item collision width follows the centralized priority boost', () => {
    const source = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
    const rebuildBody = source.match(/function rebuildStackingLayout\(\)\s*{([\s\S]*?)\n}/)?.[1] ?? '';

    assert.match(rebuildBody, /baseWidth \* \(isMajorMilestone \? 1 \+ priorityBoost : 1\)/);
    assert.doesNotMatch(rebuildBody, /1\.35/);
});

test('viewport culling hides distant items and loads images near the camera', () => {
    const context = loadRuntime();
    const createCullable = baseX => {
        const classes = new Set();
        const imageElement = {
            dataset: { src: `image-${baseX}.jpg` },
            hasAttribute(name) { return name === 'src' && Boolean(this.src); },
            src: '',
        };
        return {
            baseX,
            element: {
                classList: {
                    toggle(name, force) {
                        if (force) classes.add(name);
                        else classes.delete(name);
                    },
                },
            },
            imageElement,
            classes,
        };
    };
    const near = createCullable(500);
    const far = createCullable(2500);
    context.testItems = [near, far];
    context.window.innerWidth = 1000;

    vm.runInContext('loadedItems = testItems; scale = 1; translateX = 0; updateViewportCulling()', context);
    assert.equal(near.classes.has('is-culled'), false);
    assert.equal(far.classes.has('is-culled'), true);
    assert.equal(near.imageElement.src, 'image-500.jpg');
    assert.equal(far.imageElement.src, '');

    vm.runInContext('translateX = -2000; updateViewportCulling()', context);
    assert.equal(near.classes.has('is-culled'), true);
    assert.equal(far.classes.has('is-culled'), false);
    assert.equal(far.imageElement.src, 'image-2500.jpg');
});

test('timeline and context thumbnails are created without eager src attributes', () => {
    const script = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
    const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

    assert.match(script, /<img data-src="\$\{item\.image\}" class="item-image"/);
    assert.match(script, /<img data-src="\$\{item\.image\}" class="card-image"/);
    assert.match(css, /\.is-culled\s*{/);
});
