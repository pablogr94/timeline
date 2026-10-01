import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('camera-driven vertical position does not receive a second CSS animation', () => {
    const card = css.match(/\.timeline-item\s*\{([\s\S]*?)\}/)[1];
    const transition = card.match(/transition:\s*([\s\S]*?);/)[1];
    assert.doesNotMatch(transition, /\btop\b/);
    assert.match(transition, /scale var\(--motion-hover-scale\)/);
    assert.match(transition, /opacity var\(--lod-opacity-duration/);
});

test('loaded media clears the placeholder background without changing fallback surfaces', () => {
    const loaded = css.match(/\.item-media\.is-image-loaded\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    assert.match(loaded, /background(?:-color)?:\s*transparent\s*;/);
    const media = css.match(/\.item-media\s*\{([\s\S]*?)\}/)[1];
    assert.match(media, /background-color:\s*var\(--image-placeholder-color\)/);
});

test('runtime items have unique positive integer IDs', () => {
    const { items } = JSON.parse(fs.readFileSync(new URL('../data.json', import.meta.url), 'utf8'));
    assert.ok(items.every(item => Number.isSafeInteger(item.id) && item.id > 0));
    assert.equal(new Set(items.map(item => item.id)).size, items.length);
});
