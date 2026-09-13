import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function rootFromModuleUrl(moduleUrl) {
    return path.resolve(path.dirname(fileURLToPath(moduleUrl)), '..');
}

const ROOT = rootFromModuleUrl(import.meta.url);
const VALID_SCENARIOS = new Set(['spread', 'dense']);
const VALID_DEVICES = new Set(['desktop', 'mobile']);
const DEVICE_PRESETS = {
    desktop: { width: 1418, height: 802, deviceScaleFactor: 1, mobile: false },
    mobile: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
};

function readListOption(value, label) {
    if (!value) throw new Error(`Missing ${label} value`);
    return value.split(',').map(entry => entry.trim()).filter(Boolean);
}

export function parseBenchmarkOptions(args) {
    const options = {
        counts: [26, 100, 250, 500, 1000],
        scenarios: ['spread', 'dense'],
        devices: ['desktop', 'mobile'],
        headed: false,
        frames: 180,
        runs: 3,
        output: null,
        chromePath: null,
    };

    for (const arg of args) {
        if (arg === '--headed') {
            options.headed = true;
        } else if (arg.startsWith('--counts=')) {
            options.counts = readListOption(arg.slice('--counts='.length), 'counts').map(value => {
                const count = Number(value);
                if (!Number.isInteger(count) || count <= 0) throw new Error(`Invalid item count: ${value}`);
                return count;
            });
        } else if (arg.startsWith('--scenarios=')) {
            options.scenarios = readListOption(arg.slice('--scenarios='.length), 'scenarios');
            for (const scenario of options.scenarios) {
                if (!VALID_SCENARIOS.has(scenario)) throw new Error(`Invalid scenario: ${scenario}`);
            }
        } else if (arg.startsWith('--devices=')) {
            options.devices = readListOption(arg.slice('--devices='.length), 'devices');
            for (const device of options.devices) {
                if (!VALID_DEVICES.has(device)) throw new Error(`Invalid device: ${device}`);
            }
        } else if (arg.startsWith('--frames=')) {
            options.frames = Number(arg.slice('--frames='.length));
            if (!Number.isInteger(options.frames) || options.frames < 30) {
                throw new Error(`Invalid frame count: ${arg.slice('--frames='.length)}`);
            }
        } else if (arg.startsWith('--runs=')) {
            options.runs = Number(arg.slice('--runs='.length));
            if (!Number.isInteger(options.runs) || options.runs < 1) {
                throw new Error(`Invalid run count: ${arg.slice('--runs='.length)}`);
            }
        } else if (arg.startsWith('--output=')) {
            options.output = arg.slice('--output='.length);
        } else if (arg.startsWith('--chrome=')) {
            options.chromePath = arg.slice('--chrome='.length);
        } else {
            throw new Error(`Unknown option: ${arg}`);
        }
    }

    return options;
}

function fixtureImage(index) {
    const width = 120 + (index % 5) * 20;
    const height = 100 + (index % 3) * 15;
    const shade = 32 + (index % 6) * 12;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="rgb(${shade},${shade},${shade})"/></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function buildFixture(sourceData, { count, scenario }) {
    if (!Number.isInteger(count) || count <= 0) throw new Error(`Invalid item count: ${count}`);
    if (!VALID_SCENARIOS.has(scenario)) throw new Error(`Invalid scenario: ${scenario}`);
    if (!Array.isArray(sourceData.items) || sourceData.items.length === 0) {
        throw new Error('Source data must contain at least one item');
    }

    const items = Array.from({ length: count }, (_, index) => {
        const source = sourceData.items[index % sourceData.items.length];
        const spreadYear = 1800 + Math.round((index / Math.max(1, count - 1)) * 300);
        const year = scenario === 'dense' && index < Math.ceil(count / 2) ? 1950 : spreadYear;

        return {
            ...source,
            id: `benchmark-${scenario}-${index + 1}`,
            year,
            title: `Benchmark ${scenario} item ${index + 1}`,
            image: fixtureImage(index),
            link: '',
            attribution: '',
            attributionLink: '',
        };
    });

    return { items, contexts: [] };
}

export function createFixtureSelector(sourceData) {
    let selection = { count: 26, scenario: 'spread' };
    return {
        select(nextSelection) {
            selection = { ...nextSelection };
        },
        buildCurrent() {
            return buildFixture(sourceData, selection);
        },
    };
}

export function percentile(samples, quantile) {
    if (!samples.length) return null;
    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
    return sorted[index];
}

function summarize(samples) {
    const total = samples.reduce((sum, value) => sum + value, 0);
    return {
        medianMs: Number(percentile(samples, 0.5).toFixed(3)),
        p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
        maxMs: Number(Math.max(...samples).toFixed(3)),
        meanMs: Number((total / samples.length).toFixed(3)),
    };
}

export function aggregateMeasurements(measurements) {
    const runs = measurements.map(measurement => ({
        frame: summarize(measurement.frameDurations),
        stacking: summarize(measurement.updateDurations),
        framesOver16_7Percent: Number((measurement.frameDurations.filter(value => value > 16.7).length / measurement.frameDurations.length * 100).toFixed(1)),
        framesOver33_3Percent: Number((measurement.frameDurations.filter(value => value > 33.3).length / measurement.frameDurations.length * 100).toFixed(1)),
    }));
    const rankedRuns = [...runs].sort((a, b) => a.frame.p95Ms - b.frame.p95Ms);
    const medianRun = rankedRuns[Math.max(0, Math.ceil(rankedRuns.length / 2) - 1)];
    return { ...medianRun, runs };
}

export function findChrome(explicitPath) {
    const candidates = [
        explicitPath,
        process.env.CHROME_PATH,
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
    ].filter(Boolean);
    const chromePath = candidates.find(candidate => fs.existsSync(candidate));
    if (!chromePath) throw new Error('Chrome was not found. Pass --chrome=C:/path/to/chrome.exe');
    return chromePath;
}

function mimeType(filePath) {
    return ({
        '.css': 'text/css; charset=utf-8',
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
    })[path.extname(filePath)] || 'application/octet-stream';
}

function startServer(sourceData) {
    const fixtureSelector = createFixtureSelector(sourceData);
    const server = http.createServer((request, response) => {
        const requestUrl = new URL(request.url, 'http://127.0.0.1');
        if (requestUrl.pathname === '/data.json') {
            const fixture = fixtureSelector.buildCurrent();
            response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            response.end(JSON.stringify(fixture));
            return;
        }

        const relativePath = requestUrl.pathname === '/' ? 'index.html' : decodeURIComponent(requestUrl.pathname.slice(1));
        const filePath = path.resolve(ROOT, relativePath);
        if (!filePath.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            response.writeHead(404);
            response.end('Not found');
            return;
        }

        response.writeHead(200, { 'content-type': mimeType(filePath), 'cache-control': 'no-store' });
        fs.createReadStream(filePath).pipe(response);
    });

    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve({
            server,
            port: server.address().port,
            selectFixture: fixtureSelector.select,
        }));
    });
}

async function waitFor(check, description, timeoutMs = 15000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const value = await check();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for ${description}`);
}

async function withTimeout(promise, timeoutMs, message) {
    let timeoutId;
    const timeout = new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    try {
        return await Promise.race([promise, timeout]);
    } finally {
        clearTimeout(timeoutId);
    }
}

class CdpConnection {
    constructor(url) {
        this.nextId = 1;
        this.pending = new Map();
        this.socket = new WebSocket(url);
        this.ready = new Promise((resolve, reject) => {
            this.socket.addEventListener('open', resolve, { once: true });
            this.socket.addEventListener('error', reject, { once: true });
        });
        this.socket.addEventListener('message', event => {
            const message = JSON.parse(event.data);
            if (!message.id || !this.pending.has(message.id)) return;
            const { resolve, reject } = this.pending.get(message.id);
            this.pending.delete(message.id);
            if (message.error) reject(new Error(message.error.message));
            else resolve(message.result);
        });
        this.socket.addEventListener('close', () => {
            this.rejectPending(new Error('Chrome DevTools connection closed'));
        });
        this.socket.addEventListener('error', () => {
            this.rejectPending(new Error('Chrome DevTools connection failed'));
        });
    }

    rejectPending(error) {
        for (const { reject } of this.pending.values()) reject(error);
        this.pending.clear();
    }

    async send(method, params = {}) {
        await this.ready;
        const id = this.nextId++;
        const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
        this.socket.send(JSON.stringify({ id, method, params }));
        return result;
    }

    close() {
        this.socket.close();
    }
}

export async function launchChrome(chromePath, headed, initialUrl) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-benchmark-'));
    const args = [
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-extensions',
        '--disable-component-update',
        '--window-size=1418,802',
    ];
    if (!headed) args.push('--headless=new', '--disable-gpu');
    args.push(initialUrl);

    const child = spawn(chromePath, args, { stdio: 'ignore' });
    const activePortFile = path.join(userDataDir, 'DevToolsActivePort');
    try {
        const activePort = await waitFor(() => {
            if (!fs.existsSync(activePortFile)) return null;
            const [port] = fs.readFileSync(activePortFile, 'utf8').trim().split(/\r?\n/);
            return Number(port) || null;
        }, 'Chrome DevTools port');
        return { child, userDataDir, activePort };
    } catch (error) {
        terminateProcessTree(child.pid);
        removeUserDataDirectory(userDataDir);
        throw error;
    }
}

export async function connectToPage(activePort) {
    const target = await waitFor(async () => {
        try {
            const response = await fetch(`http://127.0.0.1:${activePort}/json/list`);
            const targets = await response.json();
            return targets.find(entry => entry.type === 'page' && entry.webSocketDebuggerUrl) || null;
        } catch {
            return null;
        }
    }, 'Chrome page target');
    return new CdpConnection(target.webSocketDebuggerUrl);
}

export async function closeBrowser(activePort, dependencies = {}) {
    const fetchImpl = dependencies.fetchImpl || fetch;
    const connect = dependencies.connect || (url => new CdpConnection(url));
    const timeoutMs = dependencies.timeoutMs || 10000;
    let browserPid;
    return withTimeout((async () => {
        const response = await fetchImpl(`http://127.0.0.1:${activePort}/json/version`);
        const version = await response.json();
        const connection = connect(version.webSocketDebuggerUrl);
        try {
            const processInfo = await connection.send('SystemInfo.getProcessInfo');
            browserPid = processInfo.processInfo.find(process => process.type === 'browser')?.id;
            await connection.send('Browser.close');
            return browserPid;
        } finally {
            connection.close();
        }
    })(), timeoutMs, 'Timed out closing Chrome').catch(error => {
        error.browserPid = browserPid;
        throw error;
    });
}

export async function evaluate(connection, expression) {
    const result = await connection.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
    });
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
}

function benchmarkExpression(expectedCount, frames) {
    return `(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const waitForFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
        const deadline = performance.now() + 15000;
        while (document.querySelectorAll('.timeline-item').length !== ${expectedCount}) {
            if (performance.now() > deadline) throw new Error('fixture did not render ${expectedCount} items');
            await wait(25);
        }
        const requestedImageLoads = [...document.querySelectorAll('.timeline-item img[src]')].map(image => image.complete
            ? Promise.resolve()
            : new Promise(resolve => {
                image.addEventListener('load', resolve, { once: true });
                image.addEventListener('error', resolve, { once: true });
            }));
        await Promise.race([Promise.all(requestedImageLoads), wait(5000)]);
        for (let index = 0; index < 30; index++) await waitForFrame();

        const frameDurations = [];
        const updateDurations = [];
        let previousFrame = performance.now();
        for (let index = 0; index < ${frames}; index++) {
            await waitForFrame();
            const frameStart = performance.now();
            frameDurations.push(frameStart - previousFrame);
            previousFrame = frameStart;

            const progress = index / Math.max(1, ${frames} - 1);
            const wave = (Math.sin(progress * Math.PI * 4) + 1) / 2;
            scale = minZoomScale + wave * 0.48;
            targetScale = scale;
            const focusYear = 1800 + progress * 300;
            translateX = (window.innerWidth / 2) - ((focusYear - minYear) * pixelsPerYear * scale);
            targetTranslateX = translateX;

            const updateStart = performance.now();
            updateTransform();
            track.offsetHeight;
            updateDurations.push(performance.now() - updateStart);
        }

        return {
            renderedItems: document.querySelectorAll('.timeline-item').length,
            domElements: document.getElementsByTagName('*').length,
            frameDurations,
            updateDurations,
        };
    })()`;
}

export function removeUserDataDirectory(directory, remove = fs.rmSync) {
    remove(directory, {
        recursive: true,
        force: true,
        maxRetries: 8,
        retryDelay: 150,
    });
}

function terminateProcessTree(pid) {
    if (!pid) throw new Error('Cannot terminate Chrome without a process ID');
    if (!processIsAlive(pid)) return;
    if (process.platform === 'win32') {
        const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
        if (result.status !== 0) throw new Error(`taskkill failed for Chrome PID ${pid}`);
    } else {
        process.kill(pid, 'SIGTERM');
    }
}

function processIsAlive(pid) {
    if (!pid) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function devToolsIsReachable(activePort) {
    try {
        await fetch(`http://127.0.0.1:${activePort}/json/version`, {
            signal: AbortSignal.timeout(500),
        });
        return true;
    } catch {
        return false;
    }
}

export async function shutdownChrome(chrome) {
    if (!chrome) return;
    let browserPid;
    let gracefulError;

    try {
        browserPid = await closeBrowser(chrome.activePort);
    } catch (error) {
        browserPid = error.browserPid;
        gracefulError = error;
    }

    try {
        await waitFor(() => devToolsIsReachable(chrome.activePort).then(reachable => !reachable), 'Chrome DevTools shutdown', 5000);
        if (browserPid) await waitFor(() => !processIsAlive(browserPid), 'Chrome browser process exit', 5000);
        await waitFor(() => !processIsAlive(chrome.child.pid), 'launched Chrome process exit', 5000);
    } catch (shutdownError) {
        terminateProcessTree(browserPid || chrome.child.pid);
        terminateProcessTree(chrome.child.pid);
        await waitFor(() => devToolsIsReachable(chrome.activePort).then(reachable => !reachable), 'forced Chrome shutdown', 5000);
        if (browserPid) await waitFor(() => !processIsAlive(browserPid), 'forced Chrome browser process exit', 5000);
        await waitFor(() => !processIsAlive(chrome.child.pid), 'forced launched Chrome process exit', 5000);
    }

    removeUserDataDirectory(chrome.userDataDir);
    if (gracefulError) {
        console.warn(`Chrome required forced shutdown: ${gracefulError.message}`);
    }
}

function gitRevision() {
    const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : 'unknown';
}

function sourceFingerprint(relativePaths) {
    const hash = createHash('sha256');
    for (const relativePath of relativePaths) {
        hash.update(relativePath);
        hash.update('\0');
        hash.update(fs.readFileSync(path.join(ROOT, relativePath)));
        hash.update('\0');
    }
    return hash.digest('hex');
}

export async function runBenchmarks(options) {
    const sourceData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
    const chromePath = findChrome(options.chromePath);
    const { server, port, selectFixture } = await startServer(sourceData);
    let chrome;
    let connection;

    try {
        selectFixture({ count: options.counts[0], scenario: options.scenarios[0] });
        const firstUrl = `http://127.0.0.1:${port}/?benchmarkItems=${options.counts[0]}&benchmarkScenario=${options.scenarios[0]}`;
        chrome = await launchChrome(chromePath, options.headed, firstUrl);
        connection = await connectToPage(chrome.activePort);
        await connection.send('Page.enable');
        await connection.send('Runtime.enable');
        const versionResponse = await fetch(`http://127.0.0.1:${chrome.activePort}/json/version`);
        const chromeVersion = await versionResponse.json();
        const results = [];

        for (const device of options.devices) {
            const preset = DEVICE_PRESETS[device];
            await connection.send('Emulation.setDeviceMetricsOverride', {
                width: preset.width,
                height: preset.height,
                deviceScaleFactor: preset.deviceScaleFactor,
                mobile: preset.mobile,
            });

            for (const scenario of options.scenarios) {
                for (const count of options.counts) {
                    selectFixture({ count, scenario });
                    const url = `http://127.0.0.1:${port}/?benchmarkItems=${count}&benchmarkScenario=${scenario}`;
                    await connection.send('Page.navigate', { url });
                    await waitFor(
                        () => evaluate(connection, `document.readyState === 'complete' && document.querySelectorAll('.timeline-item').length === ${count}`),
                        `${device}/${scenario}/${count} fixture`,
                    );
                    const measurements = [];
                    let raw;
                    for (let run = 0; run < options.runs; run++) {
                        raw = await withTimeout(
                            evaluate(connection, benchmarkExpression(count, options.frames)),
                            120000,
                            `Timed out measuring ${device}/${scenario}/${count} run ${run + 1}`,
                        );
                        measurements.push(raw);
                    }
                    const aggregate = aggregateMeasurements(measurements);
                    const result = {
                        device,
                        viewport: `${preset.width}x${preset.height}@${preset.deviceScaleFactor}x`,
                        scenario,
                        items: count,
                        renderedItems: raw.renderedItems,
                        domElements: raw.domElements,
                        ...aggregate,
                    };
                    results.push(result);
                    console.log(`${device.padEnd(7)} ${scenario.padEnd(6)} ${String(count).padStart(4)} items | frame p95 ${String(aggregate.frame.p95Ms).padStart(7)} ms | stacking p95 ${String(aggregate.stacking.p95Ms).padStart(7)} ms`);
                }
            }
        }

        const report = {
            generatedAt: new Date().toISOString(),
            revision: gitRevision(),
            appSourceSha256: sourceFingerprint(['index.html', 'script.js', 'style.css', 'data.json']),
            benchmarkSha256: sourceFingerprint(['tests/performance-benchmark.mjs']),
            mode: options.headed ? 'headed' : 'headless',
            chrome: chromeVersion.Browser,
            framesPerCase: options.frames,
            runsPerCase: options.runs,
            fixture: 'Deterministic local SVG thumbnails; spread and >=50% same-year dense scenarios.',
            caveat: 'Desktop and mobile presets are automated Chrome runs. Mobile emulation is not a physical-phone result.',
            results,
        };

        if (options.output) {
            const outputPath = path.resolve(ROOT, options.output);
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
            console.log(`Report: ${outputPath}`);
        }
        return report;
    } finally {
        connection?.close();
        try {
            await shutdownChrome(chrome);
        } finally {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
        }
    }
}

async function main() {
    const options = parseBenchmarkOptions(process.argv.slice(2));
    await runBenchmarks(options);
}

const entryPoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (entryPoint === import.meta.url) {
    main().catch(error => {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    });
}
