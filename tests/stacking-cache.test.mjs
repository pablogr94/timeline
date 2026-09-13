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
            toggle() {},
        },
        querySelector() { return null; },
        style: createStyle(),
    };
    const context = {
        console,
        document: {
            body: baseElement,
            createElement() { return { ...baseElement, style: createStyle() }; },
            documentElement: { style: createStyle() },
            getElementById() { return baseElement; },
            querySelector() { return null; },
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

test('image settlement applies card geometry before revealing at a stationary camera', () => {
    const context = loadRuntime();
    assert.equal(context.animationFrames.length, 1, 'render loop should already have a frame queued');
    const classes = new Set(['is-lod-hidden']);
    const style = createStyle();
    const item = {
        baseX: 30000,
        element: {
            classList: {
                toggle(name, force) {
                    if (force) classes.add(name);
                    else classes.delete(name);
                },
            },
            offsetWidth: 80,
            style,
        },
        image: 'thumbnail.jpg',
        imageReady: false,
        isLodHidden: true,
        priority: 2,
        year: 1860,
    };
    context.testItems = [item];

    vm.runInContext('loadedItems = testItems; scale = standardItemRevealScale; targetScale = standardItemRevealScale; targetTranslateX = translateX; scheduleImageSettlement(testItems[0]); scheduleImageSettlement(testItems[0])', context);
    assert.equal(context.animationFrames.length, 2);
    assert.equal(item.imageReady, false);
    assert.equal(classes.has('is-lod-hidden'), true);

    context.animationFrames.shift()();
    assert.equal(classes.has('is-lod-hidden'), true, 'a pre-queued render frame must not reveal unsettled media');

    context.animationFrames.shift()();

    assert.equal(item.imageReady, true);
    assert.equal(classes.has('is-lod-hidden'), false);
    assert.equal(style.top, 'calc(0px * var(--inv-scale, 1))');
    assert.equal(style.properties.get('--priority-scale'), '1');
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

test('image-less timeline items render a deliberate fixed-width placeholder', () => {
    const context = loadRuntime();
    context.testItem = { title: 'Nakagin Capsule Tower', image: '' };

    const markup = vm.runInContext('buildTimelineMedia(testItem)', context);

    assert.match(markup, /item-media is-image-missing/);
    assert.match(markup, /item-image-placeholder/);
    assert.match(markup, /role="img"/);
    assert.match(markup, /No image available/);

    const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(css, /--image-placeholder-width:/);
    assert.match(css, /\.item-image-placeholder\s*{/);
});

test('failed timeline images become visible fallback cards instead of broken images', () => {
    const context = loadRuntime();
    const mediaClasses = new Set(['is-image-loading']);
    const itemClasses = new Set();
    const statusAttributes = new Map([['aria-hidden', 'true']]);
    const status = {
        textContent: 'Loading',
        removeAttribute(name) { statusAttributes.delete(name); },
        setAttribute(name, value) { statusAttributes.set(name, value); },
    };
    const media = {
        classList: {
            add(name) { mediaClasses.add(name); },
            remove(name) { mediaClasses.delete(name); },
        },
        querySelector(selector) { return selector === '.item-image-status' ? status : null; },
    };
    const item = {
        baseX: 50000,
        image: 'broken.jpg',
        imageReady: false,
        priority: 2,
        year: 1900,
        element: {
            classList: {
                toggle(name, force) {
                    if (force) itemClasses.add(name);
                    else itemClasses.delete(name);
                },
            },
            offsetWidth: 80,
            style: createStyle(),
        },
    };
    const itemElement = { timelineItem: item };
    const image = {
        alt: 'Broken example',
        hidden: false,
        closest(selector) {
            if (selector === '.item-media') return media;
            if (selector === '.timeline-item') return itemElement;
            return null;
        },
    };
    context.testImage = image;
    context.testItems = [item];

    vm.runInContext('loadedItems = testItems; scale = standardItemRevealScale; targetScale = standardItemRevealScale; targetTranslateX = translateX; window.handleImageError(testImage)', context);
    context.animationFrames.shift()();
    context.animationFrames.shift()();

    assert.equal(image.hidden, true);
    assert.equal(mediaClasses.has('is-image-loading'), false);
    assert.equal(mediaClasses.has('is-image-error'), true);
    assert.equal(status.textContent, 'Image unavailable');
    assert.equal(statusAttributes.get('role'), 'img');
    assert.equal(statusAttributes.get('aria-label'), 'Broken example: image unavailable');
    assert.equal(item.imageReady, true);
    assert.equal(itemClasses.has('is-lod-hidden'), false);
});

test('failed context images use the same visible fallback treatment', () => {
    const context = loadRuntime();
    context.testItem = { title: 'Example context', image: 'broken-context.jpg' };
    const markup = vm.runInContext('buildContextMedia(testItem)', context);
    assert.match(markup, /item-media context-media is-image-loading/);
    assert.match(markup, /onerror="handleContextImageError\(this\)"/);

    const mediaClasses = new Set(['is-image-loading']);
    const status = {
        textContent: 'Loading',
        removeAttribute() {},
        setAttribute() {},
    };
    const media = {
        classList: {
            add(name) { mediaClasses.add(name); },
            remove(name) { mediaClasses.delete(name); },
        },
        querySelector() { return status; },
    };
    const image = {
        alt: 'Example context',
        hidden: false,
        closest(selector) { return selector === '.item-media' ? media : null; },
    };
    context.testImage = image;

    vm.runInContext('window.handleContextImageError(testImage)', context);

    assert.equal(image.hidden, true);
    assert.equal(mediaClasses.has('is-image-error'), true);
    assert.equal(status.textContent, 'Image unavailable');
});

test('loaded media fully hides its loading label', () => {
    const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(css, /\.item-media\.is-image-loaded \.item-image-status\s*{[^}]*display:\s*none/s);
});

test('data loading failures replace the loading notice with a retryable error', async () => {
    const context = loadRuntime();
    const fallbackElement = context.document.getElementById('track');
    const message = { textContent: '' };
    const retry = { hidden: true };
    const statusClasses = new Set();
    const status = {
        hidden: true,
        classList: {
            toggle(name, force) {
                if (force) statusClasses.add(name);
                else statusClasses.delete(name);
            },
        },
        querySelector(selector) {
            if (selector === '.app-status-message') return message;
            if (selector === '.app-status-retry') return retry;
            return null;
        },
    };
    context.document.getElementById = id => id === 'app-status' ? status : fallbackElement;
    context.fetch = async () => ({ ok: false, status: 503 });
    context.console = { error() {} };

    await vm.runInContext('loadData()', context);

    assert.equal(status.hidden, false);
    assert.equal(statusClasses.has('is-error'), true);
    assert.equal(message.textContent, 'Timeline could not load.');
    assert.equal(retry.hidden, false);

    const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(html, /id="app-status"[^>]*role="status"/);
    assert.match(html, /class="app-status-retry"/);
    assert.match(css, /\.app-status\s*{/);
});

test('invalid context data is rejected before timeline rendering mutates state', async () => {
    const context = loadRuntime();
    const fallbackElement = context.document.getElementById('track');
    const status = {
        hidden: true,
        classList: { toggle() {} },
        querySelector() { return null; },
    };
    context.document.getElementById = id => id === 'app-status' ? status : fallbackElement;
    context.fetch = async () => ({
        ok: true,
        async json() {
            return {
                items: [{ id: 1, title: 'Example', year: 1900, image: '' }],
                contexts: { invalid: true },
            };
        },
    });
    context.console = { error() {} };

    await vm.runInContext('loadData()', context);

    assert.equal(vm.runInContext('loadedItems.length', context), 0);
    assert.equal(status.hidden, false);
});

test('render reset removes previously generated timeline and context elements', () => {
    const context = loadRuntime();
    let removed = 0;
    context.testNodes = [
        { remove() { removed++; } },
        { remove() { removed++; } },
        { remove() { removed++; } },
    ];
    vm.runInContext(`
        track.querySelectorAll = () => testNodes;
        worldEventsTrack.replaceChildren = () => { globalThis.worldTrackCleared = true; };
        culturalErasTrack.replaceChildren = () => { globalThis.cultureTrackCleared = true; };
        loadedItems = [{}];
        loadedContexts = [{}];
        clearRenderedTimeline();
    `, context);

    assert.equal(removed, 3);
    assert.equal(context.worldTrackCleared, true);
    assert.equal(context.cultureTrackCleared, true);
    assert.equal(vm.runInContext('loadedItems.length', context), 0);
    assert.equal(vm.runInContext('loadedContexts.length', context), 0);
});

test('LOD keeps major items visible and reveals standard items at one threshold', () => {
    const context = loadRuntime();
    const createLodItem = priority => {
        const classes = new Set();
        return {
            priority,
            element: {
                classList: {
                    toggle(name, force) {
                        if (force) classes.add(name);
                        else classes.delete(name);
                    },
                },
            },
            classes,
        };
    };
    const major = createLodItem(1);
    const standard = createLodItem(2);
    context.testItems = [major, standard];

    vm.runInContext('loadedItems = testItems; scale = minZoomScale; updateLevelOfDetail()', context);
    assert.equal(major.classes.has('is-lod-hidden'), false);
    assert.equal(standard.classes.has('is-lod-hidden'), true);

    vm.runInContext('scale = 0.059; updateLevelOfDetail()', context);
    assert.equal(standard.classes.has('is-lod-hidden'), true);

    vm.runInContext('scale = 0.06; updateLevelOfDetail()', context);
    assert.equal(standard.classes.has('is-lod-hidden'), false);
});

test('settled camera applies the exact final LOD threshold', () => {
    const context = loadRuntime();
    const classes = new Set(['is-lod-hidden']);
    const item = {
        baseX: 500,
        element: {
            classList: {
                toggle(name, force) {
                    if (force) classes.add(name);
                    else classes.delete(name);
                },
            },
            style: createStyle(),
        },
        image: '',
        imageReady: true,
        isLodHidden: true,
        priority: 2,
    };
    context.testItems = [item];

    vm.runInContext(`
        loadedItems = testItems;
        scale = standardItemRevealScale - 0.00005;
        targetScale = standardItemRevealScale;
        targetTranslateX = translateX;
        renderLoop();
    `, context);

    assert.equal(vm.runInContext('scale', context), 0.06);
    assert.equal(classes.has('is-lod-hidden'), false);
});

test('grid LOD creates annual marks separately from decade and century marks', () => {
    const context = loadRuntime();
    const created = [];
    context.document.createElement = () => {
        const element = { className: '', innerText: '', style: {} };
        created.push(element);
        return element;
    };

    vm.runInContext('renderGridLines()', context);

    assert.equal(created.filter(element => element.className === 'century-line').length, 4);
    assert.equal(created.filter(element => element.className === 'half-century-line').length, 3);
    assert.equal(created.filter(element => element.className === 'decade-line').length, 24);
    assert.equal(created.filter(element => element.className === 'year-label decade-year-label').length, 24);
    assert.equal(created.filter(element => element.className === 'single-year-line').length, 270);
    assert.equal(created.filter(element => element.className === 'year-label single-year-label').length, 270);
});

test('mobile source hiding does not override standard-item LOD opacity', () => {
    const script = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
    const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

    assert.match(script, /el\.classList\.add\('is-mobile-source-hidden'\)/);
    assert.match(script, /el\.classList\.remove\('is-mobile-source-hidden'\)/);
    assert.doesNotMatch(script, /el\.style\.opacity = '[01]'/);
    assert.match(css, /\.timeline-item\.is-mobile-source-hidden\s*{/);
});

test('standard-item LOD uses a slower entrance than exit', () => {
    const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

    assert.match(css, /--motion-lod-enter:\s*0\.4s/);
    assert.match(css, /--motion-lod-exit:\s*0\.2s/);
    assert.match(css, /\.timeline-item\.priority-standard\s*{[^}]*--lod-opacity-duration:\s*var\(--motion-lod-enter\)/s);
    assert.match(css, /\.timeline-item\.is-lod-hidden\s*{[^}]*--lod-opacity-duration:\s*var\(--motion-lod-exit\)/s);
});

test('standard image cards wait for their first image load before revealing', () => {
    const context = loadRuntime();
    const classes = new Set();
    const item = {
        priority: 2,
        image: 'thumbnail.jpg',
        imageReady: false,
        element: {
            classList: {
                toggle(name, force) {
                    if (force) classes.add(name);
                    else classes.delete(name);
                },
            },
        },
    };
    context.testItems = [item];

    vm.runInContext('loadedItems = testItems; scale = 0.06; updateLevelOfDetail()', context);
    assert.equal(classes.has('is-lod-hidden'), true);

    item.imageReady = true;
    vm.runInContext('updateLevelOfDetail()', context);
    assert.equal(classes.has('is-lod-hidden'), false);
});

test('standard thumbnails preload before their reveal threshold', () => {
    const context = loadRuntime();
    const imageElement = {
        dataset: { src: 'thumbnail.jpg' },
        hasAttribute(name) { return name === 'src' && Boolean(this.src); },
        src: '',
    };
    const item = {
        baseX: 500,
        element: { classList: { toggle() {} } },
        imageElement,
        isLodHidden: true,
        priority: 2,
    };
    context.testItems = [item];
    context.window.innerWidth = 1000;

    vm.runInContext('loadedItems = testItems; scale = 0.045; translateX = 0; updateViewportCulling()', context);
    assert.equal(imageElement.src, 'thumbnail.jpg');
});

test('grid lines keep a full viewport-crossing height at every zoom level', () => {
    const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

    for (const selector of ['century-line', 'half-century-line', 'decade-line', 'single-year-line']) {
        const block = css.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`, 's'))?.[1] || '';
        assert.match(block, /top:\s*calc\(-100vh \* var\(--inv-scale, 1\)\)/);
        assert.match(block, /height:\s*calc\(200vh \* var\(--inv-scale, 1\)\)/);
    }

});

test('maximum zoom-out shows 50-year marks before decade detail', () => {
    const context = loadRuntime();
    const trackStyle = context.document.getElementById('track').style;

    vm.runInContext('scale = minZoomScale; updateLevelOfDetail()', context);
    assert.equal(trackStyle.properties.get('--decade-grid-opacity'), '0');
    assert.equal(trackStyle.properties.get('--decade-label-opacity'), '0');

    vm.runInContext('scale = 0.06; updateLevelOfDetail()', context);
    assert.equal(trackStyle.properties.get('--decade-grid-opacity'), '1');
    assert.equal(trackStyle.properties.get('--decade-label-opacity'), '1');

    const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const halfCenturyBlock = css.match(/\.half-century-line\s*\{([^}]*)\}/s)?.[1] || '';
    const decadeBlock = css.match(/\.decade-line\s*\{([^}]*)\}/s)?.[1] || '';
    assert.doesNotMatch(halfCenturyBlock, /opacity:/);
    assert.match(decadeBlock, /opacity:\s*var\(--decade-grid-opacity, 0\)/);
});

test('overview grid lines use solid strokes that survive minimum zoom', () => {
    const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const centuryBlock = css.match(/\.century-line\s*\{([^}]*)\}/s)?.[1] || '';
    const halfCenturyBlock = css.match(/\.half-century-line\s*\{([^}]*)\}/s)?.[1] || '';

    assert.match(centuryBlock, /border-left:\s*1px solid var\(--century-grid-color\)/);
    assert.match(halfCenturyBlock, /border-left:\s*1px solid var\(--half-century-grid-color\)/);
    assert.match(css, /--century-grid-color:\s*rgba\(0, 0, 0, 0\.20\)/);
    assert.match(css, /--half-century-grid-color:\s*rgba\(0, 0, 0, 0\.14\)/);
});
