import assert from 'node:assert/strict';

import {
    connectToPage,
    evaluate,
    findChrome,
    launchChrome,
    shutdownChrome,
} from './performance-benchmark.mjs';

const APP_URL = process.argv[2] || 'http://127.0.0.1:8000';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForApp(connection) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        const ready = await evaluate(connection, `document.readyState === 'complete'
            && document.querySelectorAll('.timeline-item').length === 26
            && document.querySelectorAll('.context-item').length === 10`);
        if (ready) return;
        await wait(50);
    }
    throw new Error('Timeline did not render the expected 26 items and 10 contexts');
}

async function navigateForTest(connection) {
    await connection.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `window.__timelineErrors = [];
            window.addEventListener('error', event => window.__timelineErrors.push(event.message));
            window.addEventListener('unhandledrejection', event => window.__timelineErrors.push(String(event.reason)));`,
    });
    await connection.send('Page.navigate', { url: APP_URL });
    await waitForApp(connection);
    await wait(500);
}

async function runDesktop(connection) {
    await connection.send('Emulation.setDeviceMetricsOverride', {
        width: 1418,
        height: 802,
        deviceScaleFactor: 1,
        mobile: false,
    });
    await connection.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await navigateForTest(connection);

    const grid = await evaluate(connection, `(() => {
        const ids = ['century-grid-layer', 'half-century-grid-layer', 'decade-grid-layer', 'annual-grid-layer'];
        return {
            layers: ids.map(id => {
                const element = document.getElementById(id);
                const style = getComputedStyle(element);
                return {
                    id,
                    height: element.getBoundingClientRect().height,
                    backgroundImage: style.backgroundImage,
                    backgroundSize: style.backgroundSize,
                };
            }),
            oldLineElements: document.querySelectorAll('.century-line, .half-century-line, .decade-line, .single-year-line').length,
            decadeLabels: document.querySelectorAll('.decade-year-label').length,
        };
    })()`);
    assert.equal(grid.layers.length, 4, 'four screen-space grid layers should render');
    assert.equal(grid.oldLineElements, 0, 'the grid should not create hundreds of line elements');
    assert.equal(grid.decadeLabels, 24, '10-year labels should remain available for LOD');
    grid.layers.forEach(layer => {
        assert.equal(layer.height, 802, `${layer.id} should stay viewport-height`);
        assert.notEqual(layer.backgroundImage, 'none', `${layer.id} should render its line pattern`);
    });

    await wait(1000);
    const mediaStates = await evaluate(connection, `(() => {
        const placeholders = [...document.querySelectorAll('.timeline-item .is-image-missing')];
        const standardImages = [...document.querySelectorAll('.timeline-item.priority-standard img')];
        return {
            appStatusHidden: document.getElementById('app-status').hidden,
            appStatusMessage: document.querySelector('.app-status-message').textContent,
            missingCount: placeholders.length,
            minimumWidth: Math.min(...placeholders.map(element => element.getBoundingClientRect().width)),
            queuedStandardImages: standardImages.filter(image => image.dataset.loadState).length,
            standardImageCount: standardImages.length,
        };
    })()`);
    assert.equal(mediaStates.appStatusHidden, true, 'loading status should hide after data renders');
    assert.notEqual(mediaStates.appStatusMessage, 'Preparing details…', 'background preload should not show a status message');
    assert.equal(mediaStates.missingCount, 5, 'all five image-less records should render placeholders');
    assert.ok(mediaStates.minimumWidth >= 79, 'image-less records should retain a usable card width');
    assert.equal(mediaStates.queuedStandardImages, mediaStates.standardImageCount, 'standard-card images should preload during overview idle time');

    const initialTransform = await evaluate(connection, `document.getElementById('track').style.transform`);
    await connection.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: 700,
        y: 400,
        deltaX: 0,
        deltaY: -120,
    });
    await wait(700);
    const zoomTransform = await evaluate(connection, `document.getElementById('track').style.transform`);
    assert.notEqual(zoomTransform, initialTransform, 'desktop wheel should zoom the timeline');

    await connection.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 700, y: 700, button: 'left', clickCount: 1 });
    await connection.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 850, y: 700, button: 'left', buttons: 1 });
    await connection.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 850, y: 700, button: 'left', clickCount: 1 });
    await wait(100);
    const dragTransform = await evaluate(connection, `document.getElementById('track').style.transform`);
    assert.notEqual(dragTransform, zoomTransform, 'desktop drag should pan the timeline');
}

async function runMobile(connection) {
    await connection.send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 3,
        mobile: true,
    });
    await connection.send('Emulation.setTouchEmulationEnabled', { enabled: true, configuration: 'mobile' });
    await navigateForTest(connection);

    const initialTransform = await evaluate(connection, `document.getElementById('track').style.transform`);
    await connection.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 700 }] });
    await connection.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 275, y: 700 }] });
    await connection.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(150);
    const panTransform = await evaluate(connection, `document.getElementById('track').style.transform`);
    assert.notEqual(panTransform, initialTransform, 'one-finger touch should pan the timeline');

    await connection.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: 145, y: 500 }, { x: 245, y: 500 }],
    });
    await connection.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: 105, y: 500 }, { x: 285, y: 500 }],
    });
    await connection.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(700);
    const pinchTransform = await evaluate(connection, `document.getElementById('track').style.transform`);
    assert.notEqual(pinchTransform, panTransform, 'two-finger touch should zoom the timeline');

    const cloneCount = await evaluate(connection, `(() => {
        document.querySelector('.timeline-item').click();
        return document.querySelectorAll('.mobile-clone').length;
    })()`);
    assert.equal(cloneCount, 1, 'mobile item tap should create the expanded card clone');
    await evaluate(connection, `document.querySelector('.mobile-clone .close-btn').click()`);
    await wait(500);
    assert.equal(await evaluate(connection, `document.querySelectorAll('.mobile-clone').length`), 0);
}

async function main() {
    const chrome = await launchChrome(findChrome(), false, APP_URL);
    let connection;
    try {
        connection = await connectToPage(chrome.activePort);
        await connection.send('Page.enable');
        await connection.send('Runtime.enable');
        await runDesktop(connection);
        await runMobile(connection);
        const errors = await evaluate(connection, `window.__timelineErrors`);
        assert.deepEqual(errors, []);
        console.log('Browser regression passed: desktop wheel/drag and mobile pan/pinch/card expansion.');
    } finally {
        connection?.close();
        await shutdownChrome(chrome);
    }
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
