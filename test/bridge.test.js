import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNoahCompanyClient, createNoahMiniappClient, mountNoahMiniappHost } from '../index.js';

function pair() {
  const hostOrigin = 'https://dev.noahero.com';
  const appOrigin = 'https://te-pinta.example';
  const hostListeners = new Set();
  const childListeners = new Set();
  const hostWindow = {
    addEventListener: (_, fn) => hostListeners.add(fn),
    removeEventListener: (_, fn) => hostListeners.delete(fn),
  };
  const childWindow = {
    addEventListener: (_, fn) => childListeners.add(fn),
    removeEventListener: (_, fn) => childListeners.delete(fn),
  };
  const parent = {
    postMessage(data, targetOrigin) {
      if (targetOrigin === hostOrigin) queueMicrotask(() => {
        for (const fn of hostListeners) fn({ origin: appOrigin, source: frame.contentWindow, data });
      });
    },
  };
  const frame = { contentWindow: {
    postMessage(data, targetOrigin) {
      if (targetOrigin === appOrigin) queueMicrotask(() => {
        for (const fn of childListeners) fn({ origin: hostOrigin, source: parent, data });
      });
    },
  } };
  childWindow.parent = parent;
  return {
    frame, hostWindow, childWindow, hostOrigin, appOrigin,
    spoofHost(data, origin = 'https://evil.example') {
      for (const fn of hostListeners) fn({ origin, source: frame.contentWindow, data });
    },
    spoofChild(data, origin = 'https://evil.example') {
      for (const fn of childListeners) fn({ origin, source: parent, data });
    },
  };
}

test('the app reads only its bound company and can open a product', async () => {
  const p = pair();
  const calls = [];
  const host = mountNoahMiniappHost({
    frame: p.frame, appOrigin: p.appOrigin, companySlug: 'te-pinta', windowObject: p.hostWindow,
    listObservedProducts: async (slug, options) => {
      calls.push({ slug, options });
      return { company: { id: 'c', slug, legalName: 'TPP', tradeName: null, private: 'never send' },
        products: [], page: { nextCursor: null } };
    },
    openProduct: async (id) => calls.push({ opened: id }),
  });
  const client = createNoahMiniappClient({ noahOrigin: p.hostOrigin, windowObject: p.childWindow });
  assert.equal((await client.connect()).companySlug, 'te-pinta');
  const page = await client.listObservedProducts();
  assert.equal(page.company.slug, 'te-pinta');
  assert.equal('private' in page.company, false);
  await client.openProduct('652876c1-fa68-4352-b96a-e3167f76371d');
  assert.deepEqual(calls, [
    { slug: 'te-pinta', options: { cursor: undefined, limit: 24 } },
    { opened: '652876c1-fa68-4352-b96a-e3167f76371d' },
  ]);
  client.close();
  host.close();
});

test('the bridge rejects wrong origins and unsupported actions', async () => {
  const p = pair();
  let reads = 0;
  const host = mountNoahMiniappHost({
    frame: p.frame, appOrigin: p.appOrigin, companySlug: 'te-pinta', windowObject: p.hostWindow,
    listObservedProducts: async () => { reads++; return {}; }, openProduct: () => {},
  });
  p.spoofHost({ source: 'noah.company-miniapp', version: 1, type: 'READY' });
  const client = createNoahMiniappClient({ noahOrigin: p.hostOrigin, windowObject: p.childWindow });
  p.spoofChild({ source: 'noah.company-miniapp', version: 1, type: 'HELLO', session: 'forged', companySlug: 'wrong' });
  assert.equal((await client.connect()).companySlug, 'te-pinta');
  assert.throws(() => client.listObservedProducts({ limit: 1000 }), /Invalid catalog page/);
  await assert.rejects(() => client.openProduct('../notes'), /Produto inválido/);
  assert.equal(reads, 0);
  client.close();
  host.close();
});

test('theme events stay inside the session', async () => {
  const p = pair();
  const host = mountNoahMiniappHost({
    frame: p.frame, appOrigin: p.appOrigin, companySlug: 'te-pinta', windowObject: p.hostWindow,
    listObservedProducts: async () => ({}), openProduct: () => {},
  });
  const client = createNoahMiniappClient({ noahOrigin: p.hostOrigin, windowObject: p.childWindow });
  await client.connect();
  const themes = [];
  client.onTheme((value) => themes.push(value));
  host.setTheme('dark');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(themes, ['dark']);
  client.close();
  host.close();
});

test('a mismatched company response is not forwarded to the miniapp', async () => {
  const p = pair();
  const host = mountNoahMiniappHost({
    frame: p.frame, appOrigin: p.appOrigin, companySlug: 'te-pinta', windowObject: p.hostWindow,
    listObservedProducts: async () => ({
      company: { id: 'other', slug: 'outra-empresa', legalName: 'Outra', tradeName: null },
      products: [], page: { nextCursor: null },
    }),
    openProduct: () => {},
  });
  const client = createNoahMiniappClient({ noahOrigin: p.hostOrigin, windowObject: p.childWindow });
  await assert.rejects(() => client.listObservedProducts(), /Operação indisponível/);
  client.close();
  host.close();
});

test('non-HTTPS production origins are rejected', () => {
  const p = pair();
  assert.throws(() => createNoahMiniappClient({ noahOrigin: 'http://dev.noahero.com', windowObject: p.childWindow }), /HTTPS/);
});

test('standalone mode reads public Noah data without credentials and opens products at Noah', async () => {
  const visited = [];
  const calls = [];
  const client = createNoahCompanyClient({
    noahOrigin: 'https://dev.noahero.com', companySlug: 'te-pinta', mode: 'standalone',
    windowObject: { location: { assign: (url) => visited.push(url) } },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({
        company: { id: 'c', slug: 'te-pinta', legalName: 'TPP', tradeName: null, secret: 'hidden' },
        products: [{ product: { id: 'p', name: 'Sabonete', gtin: null, imageUrl: null, brand: null, secret: 'hidden' },
          unitPrice: '5.90', observedOn: '2026-11-06', observationCount: 1, secret: 'hidden' }],
        page: { nextCursor: null }, secret: 'hidden',
      }) };
    },
  });
  assert.equal((await client.connect()).mode, 'standalone');
  const page = await client.listObservedProducts({ limit: 1 });
  assert.equal(page.products[0].observedUnitPrice, '5.90');
  assert.equal(page.products[0].availability, 'NOT_CONFIRMED');
  assert.equal('secret' in page.company, false);
  assert.equal('secret' in page.products[0].product, false);
  assert.equal(calls[0].url, 'https://dev.noahero.com/api/catalog/companies/te-pinta?limit=1');
  assert.equal(calls[0].options.credentials, 'omit');
  await client.openProduct('652876c1-fa68-4352-b96a-e3167f76371d');
  assert.deepEqual(visited, ['https://dev.noahero.com/products/652876c1-fa68-4352-b96a-e3167f76371d']);
  client.close();
});

test('auto mode uses the bridge when Noah hosts the same company', async () => {
  const p = pair();
  const host = mountNoahMiniappHost({
    frame: p.frame, appOrigin: p.appOrigin, companySlug: 'te-pinta', windowObject: p.hostWindow,
    listObservedProducts: async (slug) => ({ company: { id: 'c', slug, legalName: 'TPP', tradeName: null },
      products: [], page: { nextCursor: null } }), openProduct: () => {},
  });
  const client = createNoahCompanyClient({ noahOrigin: p.hostOrigin, companySlug: 'te-pinta', windowObject: p.childWindow,
    fetchImpl: async () => { throw new Error('HTTP must not be used in embedded mode.'); } });
  assert.equal((await client.connect()).mode, 'embedded');
  assert.equal((await client.listObservedProducts()).company.slug, 'te-pinta');
  client.close();
  host.close();
});

test('embedded mode refuses a host bound to another company', async () => {
  const p = pair();
  const host = mountNoahMiniappHost({
    frame: p.frame, appOrigin: p.appOrigin, companySlug: 'outra-empresa', windowObject: p.hostWindow,
    listObservedProducts: async () => ({}), openProduct: () => {},
  });
  const client = createNoahCompanyClient({ noahOrigin: p.hostOrigin, companySlug: 'te-pinta', windowObject: p.childWindow });
  await assert.rejects(() => client.listPublishedProducts(), /outra empresa/);
  client.close();
  host.close();
});

test('the same credential-free showcase API works inside and outside Noah', async () => {
  const p = pair();
  const host = mountNoahMiniappHost({
    frame: p.frame, appOrigin: p.appOrigin, companySlug: 'te-pinta', windowObject: p.hostWindow,
    listObservedProducts: async () => { throw new Error('The editorial catalog does not use fiscal observations.'); },
    openProduct: () => {},
  });
  const productId = '652876c1-fa68-4352-b96a-e3167f76371d';
  const response = {
    company: { id: 'c', slug: 'te-pinta' },
    items: [{ productId, revision: 1, content: { title: 'Sabonete', description: 'Descrição da empresa',
      category: null, collections: [], media: [],
      provenance: { title: 'https://te-pinta.example', description: 'https://te-pinta.example', category: null, collections: null } } }],
    page: { nextCursor: productId },
  };
  let requestCount = 0;
  const fetchImpl = async (url, options) => {
    requestCount++;
    assert.equal(url, `${p.hostOrigin}/api/catalog/companies/te-pinta/showcase?limit=2&cursor=${productId}`);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-cache');
    return { ok: true, json: async () => response };
  };
  for (const mode of ['embedded', 'standalone']) {
    const client = createNoahCompanyClient({
      noahOrigin: p.hostOrigin, companySlug: 'te-pinta', windowObject: p.childWindow, mode, fetchImpl,
    });
    try {
      assert.equal((await client.connect()).mode, mode);
      assert.deepEqual(await client.listPublishedProducts({ cursor: productId, limit: 2 }), response);
    } finally {
      client.close();
    }
  }
  assert.equal(requestCount, 2);
  host.close();
});

test('public company information is tenant-bound and credential-free in both modes', async () => {
  const p = pair();
  const company = {
    id: '47e8cae4-4bab-442a-88d8-d62761593165', slug: 'te-pinta', cnpj: '21473991000108',
    legalName: 'Razão Social', tradeName: 'Te Pinta Pequena', phone: null,
    address: { street: null, number: null, district: null, city: 'São Luís', state: 'MA', postalCode: null },
    coordinates: { latitude: -2.53, longitude: -44.3 }, locationVerified: false, status: 'CLAIMED',
  };
  const catalog = { company: { ...company, private: 'must stay private' }, products: [], page: { nextCursor: null } };
  const host = mountNoahMiniappHost({
    frame: p.frame, appOrigin: p.appOrigin, companySlug: 'te-pinta', windowObject: p.hostWindow,
    listObservedProducts: async (slug, options) => {
      assert.equal(slug, 'te-pinta');
      assert.equal(options.limit, 1);
      return catalog;
    },
    openProduct: () => {},
  });
  let httpReads = 0;
  for (const mode of ['embedded', 'standalone']) {
    const client = createNoahCompanyClient({
      noahOrigin: p.hostOrigin, companySlug: 'te-pinta', windowObject: p.childWindow, mode,
      fetchImpl: async (url, options) => {
        httpReads++;
        assert.equal(url, p.hostOrigin + '/api/catalog/companies/te-pinta?limit=1');
        assert.equal(options.credentials, 'omit');
        return { ok: true, json: async () => catalog };
      },
    });
    try {
      assert.deepEqual(await client.getCompanyProfile(), company);
    } finally {
      client.close();
    }
  }
  assert.equal(httpReads, 1);
  host.close();
});

test('embedded menu and reaction controls delegate to the native host with the bound company', async () => {
  const p = pair();
  const company = {
    id: '47e8cae4-4bab-442a-88d8-d62761593165', slug: 'te-pinta', cnpj: '21473991000108',
    legalName: 'Razão Social', tradeName: 'Te Pinta Pequena', phone: null,
    address: { street: null, number: null, district: null, city: null, state: null, postalCode: null },
    coordinates: null, locationVerified: false, status: 'CLAIMED',
  };
  const events = [];
  const host = mountNoahMiniappHost({
    frame: p.frame, appOrigin: p.appOrigin, companySlug: 'te-pinta', windowObject: p.hostWindow,
    listObservedProducts: async () => ({ company, products: [], page: { nextCursor: null } }),
    openProduct: () => {},
    openMenu: (target) => events.push({ menu: target }),
    openSocialActions: (target) => events.push({ reaction: target }),
    onControlsChange: (mounted) => events.push({ mounted }),
  });
  const client = createNoahCompanyClient({ noahOrigin: p.hostOrigin, companySlug: 'te-pinta', mode: 'embedded', windowObject: p.childWindow });
  try {
    await client.setControlsMounted(true);
    await client.openNoahMenu();
    await client.openSocialActions({ intent: 'LIKE' });
    await client.setControlsMounted(false);
    assert.deepEqual(events, [
      { mounted: true }, { menu: { targetType: 'COMPANY', targetId: company.id } },
      { reaction: { targetType: 'COMPANY', targetId: company.id, intent: 'LIKE' } }, { mounted: false },
    ]);
  } finally {
    client.close();
    host.close();
  }
});

test('product opinions are global and composer navigation remains on Noah', async () => {
  const targetId = '652876c1-fa68-4352-b96a-e3167f76371d';
  const visited = [];
  let reads = 0;
  const client = createNoahCompanyClient({
    noahOrigin: 'https://dev.noahero.com', companySlug: 'te-pinta', mode: 'standalone',
    windowObject: { location: { assign: (url) => visited.push(url) } },
    fetchImpl: async (url, options) => {
      reads++;
      assert.equal(url, `https://dev.noahero.com/api/catalog/opinions?targetType=PRODUCT&targetId=${targetId}&limit=20`);
      assert.equal(options.credentials, 'omit');
      return { ok: true, json: async () => ({ targetType: 'PRODUCT', targetId,
        items: [{ id: targetId, targetType: 'PRODUCT', targetId, targetName: 'Sabonete', revision: 1,
          authorLabel: 'Pessoa a1b2c3', recommendation: 'RECOMMEND', text: 'Gostei do produto.\nCompraria novamente.',
          proofLabel: 'INVOICE_PRESENTED', createdAt: '2026-11-07T12:00:00Z', updatedAt: '2026-11-07T12:00:00Z',
          invoiceId: 'private-proof', citationPath: 'https://untrusted.example' }],
        summary: { total: 1, recommend: 1, notRecommend: 0, mixed: 0 }, page: { nextCursor: null } }) };
    },
  });
  try {
    const opinions = await client.listProductOpinions(targetId);
    assert.equal(opinions.summary.total, 1);
    assert.equal(opinions.items[0].text, 'Gostei do produto.\nCompraria novamente.');
    assert.equal('invoiceId' in opinions.items[0], false);
    assert.equal(opinions.items[0].citationPath, `/opinions/${targetId}?revision=1`);
    await client.openOpinionComposer({ targetType: 'PRODUCT', productId: targetId });
    assert.deepEqual(visited, [`https://dev.noahero.com/opinions/new?targetType=PRODUCT&targetId=${targetId}`]);
    assert.equal(reads, 1);
  } finally {
    client.close();
  }
});

test('auto mode remains usable when opened inside a non-Noah frame', async () => {
  const p = pair();
  let reads = 0;
  const client = createNoahCompanyClient({
    noahOrigin: p.hostOrigin, companySlug: 'te-pinta', windowObject: p.childWindow, timeoutMs: 100,
    fetchImpl: async () => {
      reads++;
      return { ok: true, json: async () => ({
        company: { id: 'c', slug: 'te-pinta', legalName: 'TPP', tradeName: null },
        products: [], page: { nextCursor: null },
      }) };
    },
  });
  assert.equal((await client.connect()).mode, 'standalone');
  await client.listObservedProducts();
  assert.equal(reads, 1);
  client.close();
});

test('closing during an unanswered embed handshake does not fall back to a live client', async () => {
  const p = pair();
  const client = createNoahCompanyClient({
    noahOrigin: p.hostOrigin, companySlug: 'te-pinta', windowObject: p.childWindow, timeoutMs: 100,
    fetchImpl: async () => { throw new Error('Must not fetch after close.'); },
  });
  const connecting = client.connect();
  client.close();
  await assert.rejects(connecting, /Client closed/);
});
