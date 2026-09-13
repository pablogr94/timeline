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

    const decadeGrid = await evaluate(connection, `(() => {
        const lines = document.querySelectorAll('.decade-line');
        const halfCenturyLines = document.querySelectorAll('.half-century-line');
        return {
            count: lines.length,
            halfCenturyCount: halfCenturyLines.length,
            height: lines[0].getBoundingClientRect().height,
            layoutHeight: Number.parseFloat(getComputedStyle(lines[0]).height),
        };
    })()`);
    assert.equal(decadeGrid.count, 24, '10-year detail lines should remain rendered for LOD');
    assert.equal(decadeGrid.halfCenturyCount, 3, '50-year overview lines should always be rendered');
    assert.ok(decadeGrid.height >= 1600, 'decade grid lines should cross the full desktop viewport');
    assert.ok(decadeGrid.layoutHeight <= 1700, 'grid layout height should remain below GPU-unsafe counter-scaled sizes');

    const mediaStates = await evaluate(connection, `(() => {
        const placeholders = [...document.querySelectorAll('.timeline-item .is-image-missing')];
        return {
            appStatusHidden: document.getElementById('app-status').hidden,
            missingCount: placeholders.length,
            minimumWidth: Math.min(...placeholders.map(element => element.getBoundingClientRect().width)),
        };
    })()`);
    assert.equal(mediaStates.appStatusHidden, true, 'loading status should hide after data renders');
    assert.equal(mediaStates.missingCount, 5, 'all five image-less records should render placeholders');
    assert.ok(mediaStates.minimumWidth >= 79, 'image-less records should retain a usable card width');

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
