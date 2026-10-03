import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8'));
const manifestPath = path.join(root, 'images', 'catalog', 'manifest.json');

const itemByTitle = title => data.items.find(item => item.title === title);
const contextByTitle = title => data.contexts.find(item => item.title === title);

test('integrated catalog contains the selected works and omits unresolved exclusions', () => {
    assert.equal(data.items.length, 65);
    assert.equal(data.contexts.length, 10);
    assert.equal(itemByTitle('Seditionaries Punk Collection'), undefined);
    assert.equal(itemByTitle('The Little Black Dress'), undefined);
    assert.equal(new Set(data.items.map(item => item.id)).size, data.items.length);
    assert.ok(data.items.every(item => ['architecture', 'product_design', 'graphic_design', 'fashion'].includes(item.category)));
});

test('only approved text replaces reviewed records', () => {
    const crystalPalace = itemByTitle('The Crystal Palace (Hyde Park)');
    assert.ok(crystalPalace.description.includes('Standardised prefabricated parts'));
    assert.equal(itemByTitle('Hôtel Solvay').description, "Commissioned by industrialist Armand Solvay, this Brussels townhouse is Victor Horta's most lavish Art Nouveau masterpiece. It seamlessly integrates exposed ironwork, dynamic whiplash curves, and over two dozen varieties of marble into a unified work of art.");
    assert.equal(itemByTitle('Tulip Chair').description, undefined);
    assert.equal(itemByTitle('Barcelona Chair').artist, 'Ludwig Mies van der Rohe and Lilly Reich');
    assert.ok(contextByTitle('First World War').description.includes('global conflict fought across several continents'));
    assert.equal(contextByTitle('First World War').start, 1914);
    assert.ok(contextByTitle('World War II').description.includes('more than fifty nations'));
    assert.equal(contextByTitle('World War II').end, 1945);
    assert.equal(contextByTitle('Russian Revolution').end, 1923);
    assert.equal(contextByTitle('Russian Revolution').description, undefined);
});

test('selected work and context images are local, credited and bounded', () => {
    assert.ok(fs.existsSync(manifestPath));
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.assets.length, 70);
    for (const item of data.items) {
        assert.match(item.image, /^images\/catalog\/[a-z0-9-]+\.webp$/);
        assert.ok(item.attribution?.trim(), `${item.title} needs an image credit`);
        assert.match(item.attributionLink, /^https?:\/\//);
        assert.ok(fs.existsSync(path.join(root, item.image)), `${item.image} is missing`);
    }
    for (const title of ['Moon Landing', 'Art Nouveau', 'Bauhaus', 'Arts & Crafts Movement', 'Mid-Century Modernism']) {
        const item = contextByTitle(title);
        assert.match(item.image, /^images\/catalog\/context-[0-9]+\.webp$/);
        assert.ok(item.attribution?.trim(), `${title} needs an image credit`);
        assert.ok(fs.existsSync(path.join(root, item.image)));
    }
    for (const title of ['First World War', 'Russian Revolution', 'Spanish Civil War', 'World War II', 'Cold War']) {
        assert.equal(contextByTitle(title).image, undefined);
    }
    for (const asset of manifest.assets) {
        assert.ok(asset.width <= 1600 && asset.height <= 1600, `${asset.key} exceeds the dimension cap`);
        assert.ok(asset.bytes <= 900_000, `${asset.key} exceeds the size cap`);
        assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    }
});
