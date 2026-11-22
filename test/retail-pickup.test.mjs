import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  ManifestValidationError,
  buildRetailPickup,
  validateInstallation,
} from '../starter/retail-pickup/build.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const STARTER = path.join(ROOT, 'starter', 'retail-pickup');
const EXAMPLE = path.join(STARTER, 'template-installation.example.json');
const SCHEMA = path.join(STARTER, 'template-installation.v1.schema.json');
const CANONICAL_SCHEMA_SHA256 = 'fc2f442791809bc57d8aa602f4ea536f445c5d86abb061dbe0481bf5d82a2f32';

const clone = (value) => JSON.parse(JSON.stringify(value));
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'noah-retail-pickup-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function snapshot(directory, prefix = '') {
  const result = {};
  const entries = (await readdir(path.join(directory, prefix), { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(result, await snapshot(directory, relative));
    else result[relative.split(path.sep).join('/')] = createHash('sha256')
      .update(await readFile(path.join(directory, relative))).digest('hex');
  }
  return result;
}

function fakeView() {
  return {
    themes: [], units: [], companies: [], connections: [], errors: [], catalogs: [], openNoah: [],
    setTheme(value) { this.themes.push(value); },
    setUnit(value) { this.units.push(value); },
    setCompany(value) { this.companies.push(value); },
    setConnection(state, message) { this.connections.push({ state, message }); },
    showError(message) { this.errors.push(message); },
    showCatalog(products, onOpen) { this.catalogs.push({ products, onOpen }); },
    setOpenNoah(visible, onOpen) { this.openNoah.push({ visible, onOpen }); },
  };
}

function fakeWindow() {
  const listeners = new Map();
  return {
    location: { search: '?companySlug=attacker&noahOrigin=https://attacker.example' },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) {
      if (listeners.get(name) === callback) listeners.delete(name);
    },
    listeners,
  };
}

function company(slug = 'loja-de-teste') {
  return {
    id: '20000000-0000-4000-8000-000000000001', slug, cnpj: null,
    legalName: 'Loja de teste', tradeName: 'Loja de teste', phone: null,
    address: { street: null, number: null, district: null, city: null, state: null, postalCode: null },
    coordinates: null, locationVerified: false, status: 'CLAIMED',
  };
}

function catalog(slug = 'loja-de-teste') {
  return {
    company: { id: company(slug).id, slug, legalName: 'Loja de teste', tradeName: 'Loja de teste' },
    products: [{
      product: {
        id: '30000000-0000-4000-8000-000000000001', name: 'Produto sintético',
        gtin: '07891234567895', imageUrl: null, brand: 'Marca sintética',
      },
      observedUnitPrice: '10.50', observedOn: '2026-11-22', observationCount: 1,
      availability: 'NOT_CONFIRMED',
    }],
    page: { nextCursor: null },
  };
}

function fakeClient({ mode = 'standalone', theme = 'system', profile = company(), page = catalog(), fail } = {}) {
  const state = {
    closed: 0, unsubscribed: 0, openedProducts: [], openedNoah: 0, themeCallback: null,
  };
  const client = {
    async connect() { if (fail === 'connect') throw new Error('offline'); return { mode, theme, companySlug: profile.slug, capabilities: [] }; },
    async getCompanyProfile() { if (fail === 'profile') throw new Error('offline'); return profile; },
    async listObservedProducts() { if (fail === 'catalog') throw new Error('offline'); return page; },
    async openProduct(productId) { state.openedProducts.push(productId); return { opened: true }; },
    async openNoahMenu() { state.openedNoah += 1; return { opened: true }; },
    onTheme(callback) { state.themeCallback = callback; return () => { state.unsubscribed += 1; }; },
    close() { state.closed += 1; },
  };
  return { client, state };
}

async function builtApp(t) {
  const directory = await temporaryDirectory(t);
  const output = path.join(directory, 'dist');
  await buildRetailPickup({ manifestPath: EXAMPLE, outputDirectory: output });
  const moduleUrl = `${pathToFileURL(path.join(output, 'app.js')).href}?test=${randomUUID()}`;
  return { output, app: await import(moduleUrl) };
}

function manifestFetch(manifest, calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    return { ok: true, async json() { return clone(manifest); } };
  };
}

test('canonical schema bytes and example stay valid while unsafe variants fail', async () => {
  const schemaBytes = await readFile(SCHEMA);
  assert.equal(createHash('sha256').update(schemaBytes).digest('hex'), CANONICAL_SCHEMA_SHA256);
  const schema = JSON.parse(schemaBytes);
  const valid = await json(EXAMPLE);
  assert.deepEqual(validateInstallation(valid, schema), valid);

  const invalid = [];
  const origin = clone(valid); origin.noah.origin = 'https://dev.noahero.com/api'; invalid.push(origin);
  const slug = clone(valid); slug.experienceOwner.companySlug = 'Loja'; invalid.push(slug);
  const unit = clone(valid); unit.scope.unitKey = '../centro'; invalid.push(unit);
  const label = clone(valid); label.scope.unitLabel = 'Unidade\nCentro'; invalid.push(label);
  const theme = clone(valid); theme.appearance.defaultTheme = 'brand'; invalid.push(theme);
  const extra = clone(valid); extra.noah.mode = 'standalone'; invalid.push(extra);
  const secret = clone(valid); secret.noah.token = null; invalid.push(secret);
  const commerce = clone(valid); commerce.modules.checkout = { enabled: true }; invalid.push(commerce);
  for (const value of invalid) assert.throws(
    () => validateInstallation(value, schema), ManifestValidationError,
  );
});

test('builder creates deterministic package and keeps current SDK byte-identical', async (t) => {
  const directory = await temporaryDirectory(t);
  const first = path.join(directory, 'first');
  const second = path.join(directory, 'second');
  await buildRetailPickup({ manifestPath: EXAMPLE, outputDirectory: first });
  await buildRetailPickup({ manifestPath: EXAMPLE, outputDirectory: second });
  assert.deepEqual(await snapshot(first), await snapshot(second));
  assert.deepEqual(Object.keys(await snapshot(first)), [
    'app.js', 'assets/noah-company.v0.6.1.js', 'index.html', 'package.json', 'styles.css',
    'template-installation.json', 'template-installation.v1.schema.json',
  ]);
  assert.deepEqual(
    await readFile(path.join(first, 'assets', 'noah-company.v0.6.1.js')),
    await readFile(path.join(ROOT, 'index.js')),
  );
  assert.deepEqual(await readFile(path.join(first, 'template-installation.v1.schema.json')), await readFile(SCHEMA));
});

test('builder refuses existing output and preserves its contents', async (t) => {
  const directory = await temporaryDirectory(t);
  const output = path.join(directory, 'existing');
  await mkdir(output);
  await writeFile(path.join(output, 'keep.txt'), 'preserve');
  await assert.rejects(buildRetailPickup({ manifestPath: EXAMPLE, outputDirectory: output }), /already exists/);
  assert.equal(await readFile(path.join(output, 'keep.txt'), 'utf8'), 'preserve');
});

test('standalone uses trusted config, catalog navigation and idempotent teardown', async (t) => {
  const { app } = await builtApp(t);
  const manifest = await json(EXAMPLE); manifest.appearance.defaultTheme = 'dark';
  const calls = [];
  const view = fakeView();
  const windowObject = fakeWindow();
  const { client, state } = fakeClient({ mode: 'standalone', theme: 'light' });
  let factoryOptions;
  const runtime = await app.bootRetailPickup({
    view, windowObject, fetchImpl: manifestFetch(manifest, calls),
    clientFactory(options) { factoryOptions = options; return client; },
  });
  assert.equal(runtime.status, 'ready');
  assert.deepEqual(factoryOptions, {
    noahOrigin: 'https://dev.noahero.com', companySlug: 'loja-de-teste', mode: 'auto', windowObject,
  });
  assert.equal('unitKey' in factoryOptions, false);
  assert.deepEqual(view.units, ['Unidade Centro']);
  assert.deepEqual(view.themes, ['dark']);
  assert.equal(view.catalogs[0].products[0].availability, 'NOT_CONFIRMED');
  await view.catalogs[0].onOpen('30000000-0000-4000-8000-000000000001');
  assert.deepEqual(state.openedProducts, ['30000000-0000-4000-8000-000000000001']);
  assert.equal(view.openNoah.at(-1).visible, true);
  await view.openNoah.at(-1).onOpen();
  assert.equal(state.openedNoah, 1);
  assert.deepEqual(calls, [{ url: './template-installation.json', options: { cache: 'no-store', credentials: 'omit' } }]);
  runtime.close(); runtime.close();
  assert.equal(state.closed, 1);
  assert.equal(windowObject.listeners.size, 0);
});

test('embedded follows host theme, hides standalone exit and ignores URL overrides', async (t) => {
  const { app } = await builtApp(t);
  const manifest = await json(EXAMPLE); manifest.appearance.defaultTheme = 'dark';
  const view = fakeView();
  const windowObject = fakeWindow();
  const { client, state } = fakeClient({ mode: 'embedded', theme: 'light' });
  let factoryOptions;
  const runtime = await app.bootRetailPickup({
    view, windowObject, fetchImpl: manifestFetch(manifest),
    clientFactory(options) { factoryOptions = options; return client; },
  });
  assert.equal(runtime.status, 'ready');
  assert.equal(factoryOptions.companySlug, 'loja-de-teste');
  assert.equal(factoryOptions.noahOrigin, 'https://dev.noahero.com');
  assert.deepEqual(view.themes, ['dark', 'light']);
  state.themeCallback('dark');
  assert.deepEqual(view.themes, ['dark', 'light', 'dark']);
  assert.equal(view.openNoah.at(-1).visible, false);
  runtime.close();
  assert.equal(state.unsubscribed, 1);
  assert.equal(state.closed, 1);
});

test('catalog outage shows honest empty fallback and closes client', async (t) => {
  const { app } = await builtApp(t);
  const view = fakeView();
  const { client, state } = fakeClient({ fail: 'catalog' });
  const runtime = await app.bootRetailPickup({
    view, windowObject: fakeWindow(), fetchImpl: manifestFetch(await json(EXAMPLE)),
    clientFactory() { return client; },
  });
  assert.equal(runtime.status, 'error');
  assert.equal(view.catalogs.length, 0);
  assert.equal(view.errors.length, 1);
  assert.match(view.errors[0], /catálogo Noah/i);
  assert.equal(view.errors[0].includes('offline'), false);
  assert.equal(state.closed, 1);
});

test('mismatched company projection fails closed without products', async (t) => {
  const { app } = await builtApp(t);
  const view = fakeView();
  const { client, state } = fakeClient({ profile: company('outra-loja'), page: catalog('outra-loja') });
  const runtime = await app.bootRetailPickup({
    view, windowObject: fakeWindow(), fetchImpl: manifestFetch(await json(EXAMPLE)),
    clientFactory() { return client; },
  });
  assert.equal(runtime.status, 'error');
  assert.equal(view.catalogs.length, 0);
  assert.equal(state.closed, 1);
});

test('generated page is responsive and exposes no local commerce or credential path', async (t) => {
  const { output } = await builtApp(t);
  const html = await readFile(path.join(output, 'index.html'), 'utf8');
  const app = await readFile(path.join(output, 'app.js'), 'utf8');
  const css = await readFile(path.join(output, 'styles.css'), 'utf8');
  assert.match(html, /id="products"/);
  assert.match(html, /type="module" src="\.\/app\.js"/);
  assert.match(app, /createNoahCompanyClient/);
  assert.match(app, /credentials: 'omit'/);
  assert.match(css, /@media/);
  for (const source of [html, app]) {
    assert.doesNotMatch(source, /localStorage|document\.cookie|startCheckout|createCart|confirmPickup/);
  }
});
