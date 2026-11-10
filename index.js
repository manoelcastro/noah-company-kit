/** A company webapp client for standalone and Noah-embedded use. */
const SOURCE = 'noah.company-miniapp';
const VERSION = 1;
const DEFAULT_TIMEOUT_MS = 10_000;

function originOf(value) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new TypeError('A company miniapp must use HTTPS.');
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('Expected an origin without path or credentials.');
  }
  return url.origin;
}

function isMessage(value, type) {
  return value && typeof value === 'object' && value.source === SOURCE
    && value.version === VERSION && value.type === type;
}

function send(target, origin, type, fields = {}) {
  target.postMessage({ source: SOURCE, version: VERSION, type, ...fields }, origin);
}

class InputError extends Error {}

function publicCompanyProfile(company, expectedSlug) {
  const addressKeys = ['street', 'number', 'district', 'city', 'state', 'postalCode'];
  if (!company || company.slug !== expectedSlug || !validProductId(company.id)
    || !(company.cnpj === null || (typeof company.cnpj === 'string' && /^\d{14}$/.test(company.cnpj)))
    || typeof company.legalName !== 'string'
    || !(company.tradeName === null || typeof company.tradeName === 'string')
    || !(company.phone === null || typeof company.phone === 'string')
    || !company.address || !addressKeys.every((key) => company.address[key] === null || typeof company.address[key] === 'string')
    || typeof company.locationVerified !== 'boolean' || !['UNCLAIMED', 'CLAIMED'].includes(company.status)) {
    throw new Error('Invalid public company profile.');
  }
  let coordinates = null;
  if (company.coordinates !== null) {
    const { latitude, longitude } = company.coordinates ?? {};
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      throw new Error('Invalid public company coordinates.');
    }
    coordinates = { latitude, longitude };
  }
  return {
    id: company.id, slug: company.slug, cnpj: company.cnpj,
    legalName: company.legalName, tradeName: company.tradeName, phone: company.phone,
    address: Object.fromEntries(addressKeys.map((key) => [key, company.address[key]])),
    coordinates, locationVerified: company.locationVerified, status: company.status,
  };
}

function publicCatalogPage(value, expectedSlug) {
  if (!value?.company || value.company.slug !== expectedSlug
    || !Array.isArray(value.products) || !value.page) throw new Error('Invalid public catalog response.');
  return {
    company: {
      id: value.company.id, slug: value.company.slug,
      legalName: value.company.legalName, tradeName: value.company.tradeName,
    },
    products: value.products.map((offer) => ({
      product: {
        id: offer.product.id, name: offer.product.name, gtin: offer.product.gtin,
        imageUrl: offer.product.imageUrl, brand: offer.product.brand,
      },
      observedUnitPrice: offer.unitPrice,
      observedOn: offer.observedOn,
      observationCount: offer.observationCount,
      availability: 'NOT_CONFIRMED',
    })),
    page: { nextCursor: value.page.nextCursor },
  };
}

function checkPageOptions({ cursor, limit = 24 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50
    || (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 512))) {
    throw new TypeError('Invalid catalog page.');
  }
  return { cursor, limit };
}

function validProductId(productId) {
  return typeof productId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId);
}

function catalogText(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function catalogPublicUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      && url.hostname.includes('.') && !/^\d[.\d]+$/.test(url.hostname)
      && !/\.(?:localhost|local|internal)$/.test(url.hostname);
  } catch { return false; }
}

// Explicit projection: a native item is a company declaration, never a fiscal product.
function publicCompanyItem(value) {
  const c = value?.content;
  if (!validProductId(value?.itemId) || !Number.isInteger(value.revision) || value.revision < 1
    || value.source !== 'COMPANY_DECLARATION' || !c
    || !['PRODUCT', 'SERVICE', 'MENU_ITEM'].includes(c.kind)
    || !(c.sku === null || catalogText(c.sku, 80))
    || !catalogText(c.title, 200) || !catalogText(c.description, 4_000)
    || !(c.category === null || catalogText(c.category, 120))
    || !Array.isArray(c.collections) || c.collections.length > 20
    || !c.collections.every((v) => catalogText(v, 120))
    || !Array.isArray(c.media) || c.media.length > 12
    || !c.media.every((m) => m && catalogPublicUrl(m.url)
      && (m.sourceUrl === null || catalogPublicUrl(m.sourceUrl))
      && catalogText(m.license, 120) && catalogText(m.alt, 200))) {
    throw new Error('Invalid public company item.');
  }
  return {
    itemId: value.itemId, revision: value.revision, source: 'COMPANY_DECLARATION',
    content: {
      kind: c.kind, sku: c.sku, title: c.title, description: c.description, category: c.category,
      collections: [...c.collections],
      media: c.media.map((m) => ({ url: m.url, sourceUrl: m.sourceUrl, license: m.license, alt: m.alt })),
    },
  };
}

function catalogCompany(value, expectedSlug) {
  if (!validProductId(value?.id) || value.slug !== expectedSlug) {
    throw new Error('Invalid public company catalog.');
  }
  return { id: value.id, slug: value.slug };
}

function opinionTarget(target) {
  if (!['PRODUCT', 'COMPANY'].includes(target?.targetType) || !validProductId(target.targetId)) {
    throw new TypeError('Invalid opinion target.');
  }
  return { targetType: target.targetType, targetId: target.targetId };
}

export function createNoahMiniappClient({ noahOrigin, windowObject = window, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const allowedOrigin = originOf(noahOrigin);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) throw new TypeError('Invalid timeout.');
  if (windowObject.parent === windowObject) throw new Error('This client requires a Noah host frame.');
  let session = null;
  let companySlug = null;
  let theme = null;
  let capabilities = [];
  let connectPromise = null;
  let connectResolve;
  let connectReject;
  let connectTimer;
  let readyTimer;
  let closed = false;
  const pending = new Map();
  const themeListeners = new Set();

  const listener = (event) => {
    if (closed || event.origin !== allowedOrigin || event.source !== windowObject.parent) return;
    const message = event.data;
    if (isMessage(message, 'HELLO')) {
      if (session || typeof message.session !== 'string' || !message.session
        || typeof message.companySlug !== 'string' || !message.companySlug) return;
      session = message.session;
      companySlug = message.companySlug;
      theme = message.theme;
      capabilities = Array.isArray(message.capabilities) ? message.capabilities.filter((value) => typeof value === 'string') : [];
      clearTimeout(connectTimer);
      clearInterval(readyTimer);
      connectResolve?.({ companySlug, theme, capabilities: [...capabilities] });
      return;
    }
    if (isMessage(message, 'EVENT') && message.session === session && message.name === 'theme.changed') {
      theme = message.theme;
      for (const callback of themeListeners) callback(theme);
      return;
    }
    if (!isMessage(message, 'RESPONSE') || message.session !== session || typeof message.id !== 'string') return;
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    clearTimeout(task.timer);
    if (message.ok) task.resolve(message.data);
    else task.reject(new Error(typeof message.error === 'string' ? message.error : 'A operação falhou.'));
  };
  windowObject.addEventListener('message', listener);

  function connect() {
    if (closed) return Promise.reject(new Error('Client closed.'));
    if (session) return Promise.resolve({ companySlug, theme, capabilities: [...capabilities] });
    if (connectPromise) return connectPromise;
    connectPromise = new Promise((resolve, reject) => { connectResolve = resolve; connectReject = reject; });
    const ready = () => send(windowObject.parent, allowedOrigin, 'READY');
    ready();
    readyTimer = setInterval(ready, 500);
    connectTimer = setTimeout(() => {
      clearInterval(readyTimer);
      connectReject?.(new Error('Noah não respondeu à conexão do miniapp.'));
      connectPromise = null;
    }, timeoutMs);
    return connectPromise;
  }

  async function request(action, params) {
    await connect();
    if (closed) throw new Error('Client closed.');
    const id = globalThis.crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Noah não respondeu à solicitação.'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      send(windowObject.parent, allowedOrigin, 'REQUEST', { session, id, action, params });
    });
  }

  return {
    connect,
    getCompanyProfile: () => request('company.profile.get', {}),
    openOpinionComposer: (target) => request('navigation.opinion.open', opinionTarget(target)),
    openNoahMenu: (target) => request('navigation.menu.open', target ?? {}),
    openSocialActions: (target) => request('social.actions.open', target),
    setControlsMounted: (mounted) => request('navigation.controls.set', { mounted }),
    listObservedProducts: (options) => request('catalog.observed.list', checkPageOptions(options)),
    openProduct: (productId) => request('navigation.product.open', { productId }),
    onTheme(callback) {
      themeListeners.add(callback);
      return () => themeListeners.delete(callback);
    },
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(connectTimer);
      clearInterval(readyTimer);
      connectReject?.(new Error('Client closed.'));
      for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('Client closed.')); }
      pending.clear();
      themeListeners.clear();
      windowObject.removeEventListener('message', listener);
    },
  };
}

export function mountNoahMiniappHost({
  frame, appOrigin, companySlug, listObservedProducts, openProduct, openOpinion,
  openMenu, openSocialActions, onControlsChange,
  theme = 'system', windowObject = window,
}) {
  const allowedOrigin = originOf(appOrigin);
  if (!frame?.contentWindow || !companySlug || typeof listObservedProducts !== 'function'
    || typeof openProduct !== 'function') throw new TypeError('Invalid host configuration.');
  const session = globalThis.crypto.randomUUID();
  let connected = false;
  let closed = false;
  const capabilities = ['catalog.observed.read', 'company.profile.read', 'navigation.product.open'];
  if (typeof openOpinion === 'function') capabilities.push('navigation.opinion.open');
  if (typeof openMenu === 'function') capabilities.push('navigation.menu.open');
  if (typeof openSocialActions === 'function') capabilities.push('social.actions.open');

  async function boundTarget(params) {
    let target;
    try {
      if (params.targetType !== undefined) target = opinionTarget(params);
    } catch { throw new InputError('Assunto inválido.'); }
    if (!target || target.targetType === 'COMPANY') {
      const catalog = await listObservedProducts(companySlug, { limit: 1 });
      const profile = publicCompanyProfile(catalog?.company, companySlug);
      if (target && target.targetId !== profile.id) throw new InputError('Empresa inválida.');
      target = { targetType: 'COMPANY', targetId: profile.id };
    }
    return target;
  }

  const listener = async (event) => {
    if (closed || event.origin !== allowedOrigin || event.source !== frame.contentWindow) return;
    const message = event.data;
    if (isMessage(message, 'READY')) {
      connected = true;
      send(frame.contentWindow, allowedOrigin, 'HELLO', { session, companySlug, theme, capabilities });
      return;
    }
    if (!connected || !isMessage(message, 'REQUEST') || message.session !== session
      || typeof message.id !== 'string' || message.id.length > 100) return;
    try {
      const params = message.params ?? {};
      let data;
      if (message.action === 'catalog.observed.list') {
        let page;
        try { page = checkPageOptions(params); } catch { throw new InputError('Parâmetros inválidos.'); }
        data = publicCatalogPage(await listObservedProducts(companySlug, page), companySlug);
      } else if (message.action === 'company.profile.get') {
        const catalog = await listObservedProducts(companySlug, { limit: 1 });
        data = publicCompanyProfile(catalog?.company, companySlug);
      } else if (message.action === 'navigation.controls.set') {
        if (typeof params.mounted !== 'boolean') throw new InputError('Estado inválido.');
        onControlsChange?.(params.mounted);
        data = { mounted: params.mounted };
      } else if (message.action === 'navigation.menu.open' && typeof openMenu === 'function') {
        await openMenu(await boundTarget(params));
        data = { opened: true };
      } else if (message.action === 'social.actions.open' && typeof openSocialActions === 'function') {
        if (!['LIKE', 'FOLLOW'].includes(params.intent)) throw new InputError('Reação inválida.');
        await openSocialActions({ ...await boundTarget(params), intent: params.intent });
        data = { opened: true };
      } else if (message.action === 'navigation.opinion.open' && typeof openOpinion === 'function') {
        await openOpinion(await boundTarget(params));
        data = { opened: true };
      } else if (message.action === 'navigation.product.open') {
        if (!validProductId(params.productId)) {
          throw new InputError('Produto inválido.');
        }
        await openProduct(params.productId);
        data = { opened: true };
      } else {
        throw new InputError('Ação não permitida.');
      }
      if (!closed) send(frame.contentWindow, allowedOrigin, 'RESPONSE', { session, id: message.id, ok: true, data });
    } catch (error) {
      if (!closed) send(frame.contentWindow, allowedOrigin, 'RESPONSE', {
        session, id: message.id, ok: false,
        error: error instanceof InputError ? error.message : 'Operação indisponível.',
      });
    }
  };
  windowObject.addEventListener('message', listener);
  return {
    setTheme(nextTheme) {
      if (!['light', 'dark', 'system'].includes(nextTheme)) throw new TypeError('Invalid theme.');
      theme = nextTheme;
      if (connected && !closed) send(frame.contentWindow, allowedOrigin, 'EVENT', { session, name: 'theme.changed', theme });
    },
    close() { closed = true; windowObject.removeEventListener('message', listener); },
  };
}

/** Same read/navigation contract in an iframe and on the company's own domain. */
export function createNoahCompanyClient({
  noahOrigin, companySlug, mode = 'auto', windowObject = window,
  fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const origin = originOf(noahOrigin);
  if (typeof companySlug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,254}$/.test(companySlug)) {
    throw new TypeError('Invalid company slug.');
  }
  if (!['auto', 'embedded', 'standalone'].includes(mode)) throw new TypeError('Invalid mode.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) throw new TypeError('Invalid timeout.');
  let bridge = null;
  let connected = null;
  let closed = false;
  const themeListeners = new Set();

  function connect() {
    if (closed) return Promise.reject(new Error('Client closed.'));
    if (connected) return connected;
    connected = (async () => {
      if (mode !== 'standalone' && windowObject.parent && windowObject.parent !== windowObject) {
        bridge = createNoahMiniappClient({ noahOrigin: origin, windowObject, timeoutMs: mode === 'auto' ? Math.min(timeoutMs, 2_000) : timeoutMs });
        try {
          const context = await bridge.connect();
          if (context.companySlug !== companySlug) throw new Error('Noah vinculou outra empresa a esta página.');
          bridge.onTheme((theme) => { for (const callback of themeListeners) callback(theme); });
          return { ...context, mode: 'embedded' };
        } catch (error) {
          bridge.close();
          bridge = null;
          if (closed) throw new Error('Client closed.');
          if (mode === 'embedded' || (error instanceof Error && error.message.includes('outra empresa'))) throw error;
        }
      } else if (mode === 'embedded') {
        throw new Error('A página não está incorporada no Noah.');
      }
      if (closed) throw new Error('Client closed.');
      return { companySlug, theme: 'system', capabilities: ['catalog.observed.read', 'company.profile.read', 'navigation.product.open'], mode: 'standalone' };
    })();
    return connected;
  }

  async function listObservedProducts(options) {
    const page = checkPageOptions(options);
    const context = await connect();
    if (closed) throw new Error('Client closed.');
    if (context.mode === 'embedded') return bridge.listObservedProducts(page);
    const url = new URL(`/api/catalog/companies/${encodeURIComponent(companySlug)}`, origin);
    url.searchParams.set('limit', String(page.limit));
    if (page.cursor !== undefined) url.searchParams.set('cursor', page.cursor);
    const response = await fetchImpl(url.href, {
      method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit',
      cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Noah não retornou o catálogo público (${response.status}).`);
    return publicCatalogPage(await response.json(), companySlug);
  }

  async function getCompanyProfile() {
    const context = await connect();
    if (closed) throw new Error('Client closed.');
    if (context.mode === 'embedded') return bridge.getCompanyProfile();
    const url = new URL(`/api/catalog/companies/${encodeURIComponent(companySlug)}`, origin);
    url.searchParams.set('limit', '1');
    const response = await fetchImpl(url.href, {
      method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit',
      cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Noah não retornou o perfil público (${response.status}).`);
    const catalog = await response.json();
    return publicCompanyProfile(catalog?.company, companySlug);
  }

  async function listPublishedProducts(options) {
    const { cursor, limit } = checkPageOptions(options);
    if (cursor !== undefined && !validProductId(cursor)) throw new TypeError('Invalid showcase cursor.');
    await connect();
    if (closed) throw new Error('Client closed.');
    const url = new URL(`/api/catalog/companies/${encodeURIComponent(companySlug)}/showcase`, origin);
    url.searchParams.set('limit', String(limit));
    if (cursor !== undefined) url.searchParams.set('cursor', cursor);
    const response = await fetchImpl(url.href, {
      method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit',
      cache: 'no-cache', signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Noah não retornou a vitrine publicada (${response.status}).`);
    const page = await response.json();
    if (page?.company?.slug !== companySlug || !Array.isArray(page.items)
      || (page.page?.nextCursor !== null && !validProductId(page.page?.nextCursor))) {
      throw new Error('Invalid public showcase response.');
    }
    return page;
  }

  async function readCompanyItems(itemId, options) {
    const { cursor, limit } = checkPageOptions(options);
    if ((cursor !== undefined && !validProductId(cursor))
      || (itemId !== undefined && !validProductId(itemId))) throw new TypeError('Invalid company item ID or cursor.');
    await connect();
    if (closed) throw new Error('Client closed.');
    const suffix = itemId === undefined ? '' : `/${itemId}`;
    const url = new URL(`/api/catalog/companies/${encodeURIComponent(companySlug)}/items${suffix}`, origin);
    if (itemId === undefined) {
      url.searchParams.set('limit', String(limit));
      if (cursor !== undefined) url.searchParams.set('cursor', cursor);
    }
    const response = await fetchImpl(url.href, {
      method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit',
      cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Noah não retornou os itens da empresa (${response.status}).`);
    const result = await response.json();
    const company = catalogCompany(result?.company, companySlug);
    if (itemId !== undefined) {
      const item = publicCompanyItem(result.item);
      if (item.itemId !== itemId) throw new Error('Invalid public company item identity.');
      return { company, item };
    }
    if (!Array.isArray(result.items)
      || (result.page?.nextCursor !== null && !validProductId(result.page?.nextCursor))) {
      throw new Error('Invalid public company items page.');
    }
    return { company, items: result.items.map(publicCompanyItem), page: { nextCursor: result.page.nextCursor } };
  }

  async function listOpinions(target, { q, cursor, limit = 20 } = {}) {
    opinionTarget(target);
    checkPageOptions({ cursor, limit });
    if ((cursor !== undefined && !validProductId(cursor))
      || (q !== undefined && (typeof q !== 'string' || q.trim().length < 2 || q.length > 120))) {
      throw new TypeError('Invalid opinion query.');
    }
    await connect();
    if (closed) throw new Error('Client closed.');
    const url = new URL('/api/catalog/opinions', origin);
    url.searchParams.set('targetType', target.targetType);
    url.searchParams.set('targetId', target.targetId);
    url.searchParams.set('limit', String(limit));
    if (cursor !== undefined) url.searchParams.set('cursor', cursor);
    if (q !== undefined) url.searchParams.set('q', q);
    const response = await fetchImpl(url.href, {
      method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit',
      cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Noah não retornou as opiniões (${response.status}).`);
    const result = await response.json();
    if (result?.targetType !== target.targetType || result?.targetId !== target.targetId
      || !Array.isArray(result.items) || !result.summary || !result.page) {
      throw new Error('Invalid public opinions response.');
    }
    const items = result.items.map((opinion) => {
      if (!validProductId(opinion?.id) || opinion.targetType !== target.targetType
        || opinion.targetId !== target.targetId || !Number.isInteger(opinion.revision) || opinion.revision < 1
        || !['RECOMMEND', 'NOT_RECOMMEND', 'MIXED'].includes(opinion.recommendation)
        || opinion.proofLabel !== 'INVOICE_PRESENTED' || typeof opinion.text !== 'string'
        || typeof opinion.authorLabel !== 'string' || typeof opinion.targetName !== 'string') {
        throw new Error('Invalid public opinion.');
      }
      return {
        id: opinion.id, targetType: target.targetType, targetId: target.targetId,
        targetName: opinion.targetName, revision: opinion.revision, authorLabel: opinion.authorLabel,
        recommendation: opinion.recommendation, text: opinion.text, proofLabel: 'INVOICE_PRESENTED',
        createdAt: opinion.createdAt, updatedAt: opinion.updatedAt,
        citationPath: `/opinions/${opinion.id}?revision=${opinion.revision}`,
      };
    });
    return {
      targetType: target.targetType, targetId: target.targetId, items,
      summary: {
        total: result.summary.total, recommend: result.summary.recommend,
        notRecommend: result.summary.notRecommend, mixed: result.summary.mixed,
      },
      page: { nextCursor: result.page.nextCursor },
    };
  }

  async function listCompanyOpinions(options) {
    const profile = await getCompanyProfile();
    return listOpinions({ targetType: 'COMPANY', targetId: profile.id }, options);
  }

  async function openOpinionComposer({ targetType, productId } = {}) {
    const targetId = targetType === 'COMPANY' ? (await getCompanyProfile()).id : productId;
    const target = opinionTarget({ targetType, targetId });
    const context = await connect();
    if (closed) throw new Error('Client closed.');
    if (context.mode === 'embedded') return bridge.openOpinionComposer(target);
    const url = new URL('/opinions/new', origin);
    url.searchParams.set('targetType', target.targetType);
    url.searchParams.set('targetId', target.targetId);
    windowObject.location.assign(url.href);
    return { opened: true };
  }

  async function openNoahMenu(target) {
    if (target && !['PRODUCT', 'COMPANY'].includes(target.targetType)) throw new TypeError('Invalid menu target.');
    const context = await connect();
    if (closed) throw new Error('Client closed.');
    const productId = target?.targetType === 'PRODUCT' ? target.productId : undefined;
    if (target?.targetType === 'PRODUCT' && !validProductId(productId)) throw new TypeError('Invalid product id.');
    if (context.mode === 'embedded') {
      return bridge.openNoahMenu(productId ? { targetType: 'PRODUCT', targetId: productId } : undefined);
    }
    const path = productId ? `/products/${productId}` : `/suppliers/${encodeURIComponent(companySlug)}`;
    windowObject.location.assign(new URL(path, origin).href);
    return { opened: true };
  }

  async function openSocialActions({ targetType = 'COMPANY', productId, intent } = {}) {
    if (!['FOLLOW', 'LIKE'].includes(intent)) throw new TypeError('Invalid social action.');
    const targetId = targetType === 'COMPANY' ? (await getCompanyProfile()).id : productId;
    const target = opinionTarget({ targetType, targetId });
    const context = await connect();
    if (closed) throw new Error('Client closed.');
    if (context.mode === 'embedded') return bridge.openSocialActions({ ...target, intent });
    const url = new URL('/reactions', origin);
    url.searchParams.set('targetType', target.targetType);
    url.searchParams.set('targetId', target.targetId);
    url.searchParams.set('intent', intent);
    windowObject.location.assign(url.href);
    return { opened: true };
  }

  async function getReactionSummary({ targetType = 'COMPANY', productId } = {}) {
    const targetId = targetType === 'COMPANY' ? (await getCompanyProfile()).id : productId;
    const target = opinionTarget({ targetType, targetId });
    await connect();
    if (closed) throw new Error('Client closed.');
    const url = new URL('/api/catalog/reactions', origin);
    url.searchParams.set('targetType', target.targetType);
    url.searchParams.set('targetId', target.targetId);
    const response = await fetchImpl(url.href, {
      method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit',
      cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Noah não retornou as reações (${response.status}).`);
    const result = await response.json();
    if (!Number.isInteger(result.followers) || result.followers < 0
      || !Number.isInteger(result.likes) || result.likes < 0) throw new Error('Invalid reaction summary.');
    return { followers: result.followers, likes: result.likes };
  }

  async function setControlsMounted(mounted) {
    if (typeof mounted !== 'boolean') throw new TypeError('Invalid controls state.');
    const context = await connect();
    if (closed) throw new Error('Client closed.');
    if (context.mode === 'embedded') await bridge.setControlsMounted(mounted);
    return { mounted };
  }

  async function openProduct(productId) {
    if (!validProductId(productId)) throw new TypeError('Invalid product id.');
    const context = await connect();
    if (closed) throw new Error('Client closed.');
    if (context.mode === 'embedded') return bridge.openProduct(productId);
    windowObject.location.assign(new URL(`/products/${productId}`, origin).href);
    return { opened: true };
  }

  return {
    connect, getCompanyProfile, listObservedProducts, listPublishedProducts, openProduct,
    listCompanyItems: (options) => readCompanyItems(undefined, options),
    getCompanyItem: (itemId) => readCompanyItems(itemId),
    listCompanyOpinions,
    listProductOpinions: (productId, options) => listOpinions({ targetType: 'PRODUCT', targetId: productId }, options),
    openOpinionComposer,
    openNoahMenu, openSocialActions, getReactionSummary, setControlsMounted,
    onTheme(callback) {
      if (typeof callback !== 'function') throw new TypeError('Expected a callback.');
      themeListeners.add(callback);
      return () => themeListeners.delete(callback);
    },
    close() {
      if (closed) return;
      closed = true;
      bridge?.close();
      themeListeners.clear();
    },
  };
}

// Shared oa geometry from the vector master, with an optical stroke for small UI sizes.
const OA_PATHS = [
  'M236 82 C209 49 174 32 132 32 C62 32 7 87 7 157 C7 227 62 282 132 282 C166 282 197 269 222 245 C237 269 264 283 296 283 C342 283 380 245 380 199 L380 240 C380 263 399 282 422 282 C446 282 465 263 465 240 L465 150 C465 84 414 32 347 32 C303 32 265 48 236 82 Z',
  'M222 245 C216 231 214 216 214 200 C214 154 251 117 296 117',
];

let oaMaskIndex = 0;

function oaIcon(doc) {
  const create = (tag, attributes) => {
    const element = doc.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    return element;
  };
  const svg = create('svg', { viewBox: '-6.72 18.74 485.72 278.46', 'aria-hidden': 'true', focusable: 'false' });
  const maskId = `noah-oa-cut-${++oaMaskIndex}`;
  const mask = create('mask', { id: maskId, maskUnits: 'userSpaceOnUse', x: '0', y: '0', width: '490', height: '310' });
  mask.append(
    create('rect', { width: '490', height: '310', fill: 'white' }),
    create('path', { d: OA_PATHS[1], fill: 'none', stroke: 'black', 'stroke-width': '5.5', 'stroke-linecap': 'round' }),
  );
  const defs = create('defs', {});
  defs.append(mask);
  svg.append(defs, create('path', {
    d: OA_PATHS[0], mask: `url(#${maskId})`, fill: 'currentColor', stroke: 'currentColor',
    'stroke-width': '5.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }));
  return svg;
}

function styledShadow(doc, element, css, nonce) {
  const shadow = element.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  if (nonce) style.nonce = nonce;
  style.textContent = css;
  shadow.append(style);
  return shadow;
}

function oaButton(doc, label) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.setAttribute('data-noah-trigger', '');
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.title = 'Toque ou segure para abrir as ações do Noah';
  button.append(oaIcon(doc));
  return button;
}

const OA_DARK_PALETTE = `
  --oa-surface:#24202b; --oa-ink:#f7f4fc; --oa-border:#52485f; --oa-hover:#352e41;
  --oa-focus:#cab5ff; --oa-shadow:#00000045; --oa-shade:#00000065;
`;
const OA_PALETTE = `
  :host { --oa-surface:#fff; --oa-ink:#17191f; --oa-border:#e1dcec; --oa-hover:#f5f1ff;
    --oa-focus:#6d42cd; --oa-shadow:#21173726; --oa-shade:#21173726; }
  :host([data-noah-theme='dark']) { ${OA_DARK_PALETTE} }
  @media (prefers-color-scheme:dark) { :host(:not([data-noah-theme='light'])) { ${OA_DARK_PALETTE} } }
`;
const OA_BUTTON_CSS = `
  ${OA_PALETTE}
  button { display:grid; place-items:center; width:56px; height:56px; box-sizing:border-box; padding:9px;
    border:1px solid var(--oa-border); border-radius:50%; color:var(--oa-ink); background:var(--oa-surface);
    box-shadow:0 4px 18px var(--oa-shadow); cursor:pointer; touch-action:none; -webkit-tap-highlight-color:transparent; }
  button:hover { background:var(--oa-hover); } button:focus-visible { outline:3px solid var(--oa-focus); outline-offset:3px; }
  svg { width:36px; height:28px; pointer-events:none; }
`;

/** One menu engine for the company orb and product images. It never writes a reaction itself. */
function radialActions({ client, target, trigger, surface, controls, initialTheme, documentObject: doc, nonce }) {
  const win = doc.defaultView;
  const host = doc.createElement('div');
  host.setAttribute('data-noah-radial-menu', '');
  host.hidden = true;
  const shadow = styledShadow(doc, host, `
    ${OA_PALETTE}
    :host { position:fixed; inset:0; z-index:2147483000; pointer-events:none; color:var(--oa-ink); font:600 12px system-ui,sans-serif; }
    :host([hidden]) { display:none!important; }
    .shade { position:absolute; inset:0; background:var(--oa-shade); pointer-events:auto; }
    [role=menu] { position:absolute; inset:0; pointer-events:none; }
    button { font:inherit; color:inherit; cursor:pointer; touch-action:none; -webkit-tap-highlight-color:transparent; }
    .action { position:absolute; width:64px; height:64px; padding:0; border:0; background:transparent;
      transform:translate(-50%,-50%); display:flex; flex-direction:column; align-items:center; gap:3px; pointer-events:auto;
      animation:noah-expand .16s ease-out; }
    @keyframes noah-expand {
      from { opacity:0; transform:translate(calc(-50% + var(--from-x)),calc(-50% + var(--from-y))) scale(.3); }
      to { opacity:1; transform:translate(-50%,-50%) scale(1); }
    }
    .disc { display:grid; place-items:center; width:44px; height:44px; border:1px solid var(--oa-border);
      border-radius:50%; background:var(--oa-surface); box-shadow:0 3px 14px var(--oa-shadow); transition:transform .12s,background .12s; }
    .disc svg { width:24px; height:22px; } .glyph { font:26px system-ui; line-height:1; }
    .label { border-radius:8px; background:var(--oa-surface); padding:1px 5px; white-space:nowrap; }
    .action[data-selected] .disc, .action:focus-visible .disc { background:var(--oa-ink); color:var(--oa-surface); transform:scale(1.12); }
    button:focus-visible { outline:3px solid var(--oa-focus); outline-offset:3px; border-radius:22px; }
    .center { position:absolute; transform:translate(-50%,-50%); width:52px; height:52px; border:1px solid var(--oa-border);
      border-radius:50%; background:var(--oa-surface); pointer-events:auto; display:grid; place-items:center; box-shadow:0 3px 18px var(--oa-shadow); }
    .center svg { width:34px; height:25px; }
    p { position:absolute; left:50%; bottom:max(16px, env(safe-area-inset-bottom, 0px)); transform:translateX(-50%);
      max-width:calc(100% - 40px); width:max-content; box-sizing:border-box; margin:0; padding:9px 14px;
      background:var(--oa-surface); border-radius:16px; text-align:center; box-shadow:0 3px 18px var(--oa-shadow); }
    @media (prefers-reduced-motion:reduce) { .disc { transition:none; } .action { animation:none; } }
  `, nonce);
  const shade = doc.createElement('div');
  shade.className = 'shade';
  const menu = doc.createElement('div');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', target ? 'Ações do produto no Noah' : 'Ações da empresa no Noah');
  const center = doc.createElement('button');
  center.type = 'button';
  center.className = 'center';
  center.setAttribute('aria-label', 'Fechar ações do Noah');
  center.tabIndex = -1;
  center.append(oaIcon(doc));
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const actions = [
    { id: 'menu', label: 'Noah', glyph: null, run: () => client.openNoahMenu(target) },
    { id: 'follow', label: 'Seguir', glyph: '+', run: () => client.openSocialActions({ targetType: 'COMPANY', ...target, intent: 'FOLLOW' }) },
    { id: 'like', label: 'Curtir', glyph: '♡', run: () => client.openSocialActions({ targetType: 'COMPANY', ...target, intent: 'LIKE' }) },
    { id: 'opinion', label: 'Avaliar', glyph: '☆', run: () => client.openOpinionComposer(target ?? { targetType: 'COMPANY' }) },
  ];
  const removers = [];
  const listen = (node, event, handler, options) => {
    node.addEventListener(event, handler, options);
    const remove = () => node.removeEventListener(event, handler, options);
    removers.push(remove);
    return remove;
  };
  let opened = false, closed = false, busy = false, selected = -1, timer, gesture;
  const applyTheme = theme => {
    if (closed) return;
    const scheme = theme === 'light' || theme === 'dark' ? theme : 'system';
    controls.dataset.noahTheme = scheme;
    host.dataset.noahTheme = scheme;
  };
  applyTheme(initialTheme);
  const unsubscribeTheme = client.onTheme?.(applyTheme);
  if (unsubscribeTheme) removers.push(unsubscribeTheme);
  if (!initialTheme && client.connect) void client.connect().then(context => applyTheme(context.theme)).catch(() => {});
  let suppressClick = false, releaseGesture = () => {}, openListeners = () => {};
  let origin = { x: 0, y: 0 }, positions = [];
  const buttons = actions.map((action, index) => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'action';
    button.tabIndex = -1;
    button.setAttribute('role', 'menuitem');
    button.setAttribute('aria-label', action.id === 'menu' ? 'Navegar no Noah' : action.label);
    button.dataset.noahAction = action.id;
    const disc = doc.createElement('span');
    disc.className = 'disc';
    disc.setAttribute('aria-hidden', 'true');
    if (action.glyph) { disc.classList.add('glyph'); disc.textContent = action.glyph; }
    else disc.append(oaIcon(doc));
    const label = doc.createElement('span');
    label.className = 'label'; label.textContent = action.label;
    button.append(disc, label);
    listen(button, 'click', event => { event.preventDefault(); event.stopPropagation(); void run(index); });
    menu.append(button);
    return button;
  });
  shadow.append(shade, menu, center, status);

  function highlight(index) {
    selected = index;
    buttons.forEach((button, i) => button.toggleAttribute('data-selected', i === index));
    status.textContent = index < 0 ? 'Arraste para escolher. Solte no centro para cancelar.' : `${actions[index].label} — solte para escolher`;
  }
  function stopGesture() {
    clearTimeout(timer);
    gesture = undefined;
    releaseGesture(); releaseGesture = () => {};
  }
  function hide(restoreFocus = false) {
    stopGesture();
    opened = false; host.hidden = true; trigger.setAttribute('aria-expanded', 'false');
    openListeners(); openListeners = () => {};
    if (restoreFocus && trigger.isConnected) trigger.focus({ preventScroll: true });
  }
  async function run(index) {
    if (closed || !opened || busy || index < 0) return;
    stopGesture(); busy = true;
    buttons.forEach(button => { button.disabled = true; });
    try { await actions[index].run(); if (!closed) hide(); }
    catch { if (!closed && opened) status.textContent = 'Não foi possível abrir o Noah. Tente novamente.'; }
    finally { busy = false; buttons.forEach(button => { button.disabled = false; }); }
  }
  function layout(point) {
    const width = win.innerWidth, height = win.innerHeight;
    origin = { x: Math.max(40, Math.min(width - 40, point.x)), y: Math.max(40, Math.min(height - 40, point.y)) };
    // Keep the instruction opposite the gesture so it never covers an action near an edge.
    status.style.top = origin.y > height / 2 ? 'max(16px, env(safe-area-inset-top, 0px))' : 'auto';
    status.style.bottom = origin.y > height / 2 ? 'auto' : 'max(16px, env(safe-area-inset-bottom, 0px))';
    const inward = Math.atan2(height / 2 - origin.y, width / 2 - origin.x);
    let best, score = Infinity;
    for (const radius of [104, 88]) {
      for (const span of [270, 180, 135, 110]) {
        for (let rotation = 0; rotation < 360; rotation += 5) {
          const middle = rotation * Math.PI / 180;
          const points = actions.map((_, i) => {
            const angle = middle + (i / (actions.length - 1) - .5) * span * Math.PI / 180;
            return { x: origin.x + radius * Math.cos(angle), y: origin.y + radius * Math.sin(angle) };
          });
          if (points.some(p => p.x < 40 || p.x > width - 40 || p.y < 40 || p.y > height - 40)) continue;
          const distance = Math.abs(Math.atan2(Math.sin(middle - inward), Math.cos(middle - inward)));
          const candidate = (270 - span) * 10 + (104 - radius) * 10 + distance;
          if (candidate < score) { best = points; score = candidate; }
        }
      }
    }
    // Very small resized viewports use a compact accessible grid instead of clipping actions.
    positions = best ?? actions.map((_, i) => ({ x: width / 2 + (i % 2 ? 40 : -40), y: height / 2 + (i < 2 ? -48 : 48) }));
    buttons.forEach((button, i) => {
      button.style.left = `${positions[i].x}px`; button.style.top = `${positions[i].y}px`;
      button.style.setProperty('--from-x', `${origin.x - positions[i].x}px`);
      button.style.setProperty('--from-y', `${origin.y - positions[i].y}px`);
    });
    center.style.left = `${origin.x}px`; center.style.top = `${origin.y}px`;
  }
  function open(point, focus = true) {
    if (closed || busy) return;
    doc.dispatchEvent(new win.CustomEvent('noah:radial:open', { detail: host }));
    const rect = trigger.getBoundingClientRect();
    layout(point ?? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
    if (!host.isConnected) doc.body.append(host);
    opened = true; host.hidden = false; trigger.setAttribute('aria-expanded', 'true'); highlight(-1);
    openListeners();
    const listeners = [];
    const temporary = (node, event, handler, options) => {
      node.addEventListener(event, handler, options);
      listeners.push(() => node.removeEventListener(event, handler, options));
    };
    temporary(doc, 'noah:radial:open', event => { if (event.detail !== host) hide(); });
    temporary(win, 'blur', () => hide());
    temporary(win, 'resize', () => hide());
    temporary(win, 'scroll', () => hide(), true);
    temporary(doc, 'visibilitychange', () => { if (doc.hidden) hide(); });
    temporary(doc, 'keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); hide(true); }
      else if (event.key === 'Tab') hide(true);
      else if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const current = buttons.indexOf(shadow.activeElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? 3
          : (current + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1) + 4) % 4;
        highlight(index); buttons[index].focus({ preventScroll: true });
      }
    });
    openListeners = () => listeners.splice(0).forEach(remove => remove());
    if (focus) buttons[0].focus({ preventScroll: true });
  }
  function hit(x, y) {
    if (Math.hypot(x - origin.x, y - origin.y) < 32) return -1;
    let index = -1, distance = 38;
    positions.forEach((point, i) => {
      const next = Math.hypot(x - point.x, y - point.y);
      if (next < distance) { index = i; distance = next; }
    });
    return index;
  }
  function begin(kind, id, point, pointerTarget) {
    if (closed || busy || gesture) return;
    suppressClick = false;
    const current = { kind, id, ...point, held: false };
    gesture = current;
    const listeners = [];
    const temporary = (node, event, handler, options) => {
      node.addEventListener(event, handler, options);
      listeners.push(() => node.removeEventListener(event, handler, options));
    };
    releaseGesture = () => {
      listeners.splice(0).forEach(remove => remove());
      if (kind === 'pointer' && pointerTarget.hasPointerCapture?.(id)) pointerTarget.releasePointerCapture(id);
    };
    const cancel = () => { const held = current.held; stopGesture(); if (held) hide(); };
    const move = (x, y, event) => {
      if (!current.held) { if (kind === 'touch' || Math.hypot(x - point.x, y - point.y) > 8) cancel(); return; }
      if (kind === 'touch' && !event.cancelable) { cancel(); return; }
      event.preventDefault(); highlight(hit(x, y));
    };
    const finish = (x, y, event) => {
      const held = current.held;
      if (held) event.preventDefault();
      const index = held ? hit(x, y) : -1;
      stopGesture();
      if (held) { if (index < 0) hide(); else void run(index); }
    };
    temporary(win, 'blur', cancel);
    temporary(doc, 'visibilitychange', () => { if (doc.hidden) cancel(); });
    temporary(doc, 'touchstart', event => { if (event.touches.length > 1) cancel(); }, { passive: true, capture: true });
    if (kind === 'touch') {
      const pointFor = touches => [...touches].find(touch => touch.identifier === id);
      temporary(surface, 'touchmove', event => { const p = pointFor(event.touches); if (p) move(p.clientX, p.clientY, event); }, { passive: false });
      temporary(surface, 'touchend', event => { const p = pointFor(event.changedTouches); if (p) finish(p.clientX, p.clientY, event); }, { passive: false });
      temporary(surface, 'touchcancel', cancel);
    } else {
      temporary(doc, 'pointermove', event => { if (event.pointerId === id) move(event.clientX, event.clientY, event); });
      temporary(doc, 'pointerup', event => { if (event.pointerId === id) finish(event.clientX, event.clientY, event); });
      temporary(doc, 'pointercancel', event => { if (event.pointerId === id) cancel(); });
      temporary(pointerTarget, 'lostpointercapture', cancel);
    }
    timer = setTimeout(() => {
      if (closed || gesture !== current) return;
      current.held = true; suppressClick = true;
      open(point, false);
      if (kind === 'pointer') { try { pointerTarget.setPointerCapture(id); } catch { cancel(); } }
    }, 420);
  }
  const eligible = event => event.composedPath().includes(trigger)
    || !event.target.closest?.('button,input,select,textarea,[contenteditable=true]');
  listen(surface, 'pointerdown', event => {
    if (event.button !== 0 || event.isPrimary === false || !eligible(event)) return;
    if (event.pointerType === 'touch' && 'ontouchstart' in win) return;
    begin('pointer', event.pointerId, { x: event.clientX, y: event.clientY }, surface);
  });
  listen(surface, 'touchstart', event => {
    if (event.touches.length !== 1 || !eligible(event)) return;
    const point = event.touches[0];
    begin('touch', point.identifier, { x: point.clientX, y: point.clientY });
  }, { passive: true });
  listen(surface, 'click', event => {
    if (suppressClick && event.detail !== 0) {
      suppressClick = false; event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  listen(surface, 'contextmenu', event => { if (gesture) event.preventDefault(); });
  listen(surface, 'dragstart', event => { if (gesture?.held) event.preventDefault(); else stopGesture(); });
  listen(trigger, 'click', event => { event.preventDefault(); event.stopPropagation(); if (opened) hide(true); else open(); });
  listen(trigger, 'keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); event.stopPropagation(); open();
      if (event.key === 'ArrowUp') buttons.at(-1).focus({ preventScroll: true });
    }
  });
  listen(shade, 'pointerdown', event => { event.preventDefault(); hide(true); });
  listen(center, 'click', () => hide(true));
  return {
    open: () => open(),
    close() { if (closed) return; hide(); closed = true; removers.forEach(remove => remove()); host.remove(); },
  };
}

/** Floating oa orb. Hold and slide, or click and use the accessible menu. */
export async function mountNoahControls({
  client, noahOrigin, container, bottomOffset = 88, nonce, documentObject = document,
}) {
  originOf(noahOrigin);
  if (!Number.isInteger(bottomOffset) || bottomOffset < 0 || bottomOffset > 300) throw new TypeError('Invalid controls offset.');
  const context = await client.connect();
  const element = documentObject.createElement('div');
  element.setAttribute('data-noah-sdk-controls', '');
  const shadow = styledShadow(documentObject, element, `
    :host { position:fixed; right:12px; bottom:calc(${bottomOffset}px + env(safe-area-inset-bottom, 0px)); z-index:1000; }
    ${OA_BUTTON_CSS}
  `, nonce);
  const trigger = oaButton(documentObject, context.mode === 'embedded' ? 'Menu Noah' : 'Abrir o Noah');
  shadow.append(trigger);
  (container ?? documentObject.body).append(element);
  const radial = radialActions({ client, trigger, surface: trigger, controls: element, initialTheme: context.theme, documentObject, nonce });
  try { await client.setControlsMounted(true); }
  catch { radial.close(); element.remove(); throw new Error('Noah não confirmou os controles da página.'); }
  let closed = false;
  return {
    close() {
      if (closed) return; closed = true;
      radial.close(); element.remove();
      void client.setControlsMounted(false).catch(() => {});
    },
  };
}

/** Add contextual oa actions to a non-interactive image wrapper with a confirmed Noah product ID. */
export function mountNoahProductActions({ client, noahOrigin, element, productId, nonce }) {
  originOf(noahOrigin);
  if (!validProductId(productId) || !element?.ownerDocument || element.matches('img,a,button,input,select,textarea')) {
    throw new TypeError('Use an image wrapper and a confirmed Noah product UUID.');
  }
  if (element.querySelector(':scope > [data-noah-sdk-product-controls]')) throw new TypeError('Product actions already mounted.');
  const doc = element.ownerDocument;
  const previous = new Map();
  function setStyle(name, value) {
    previous.set(name, [element.style.getPropertyValue(name), element.style.getPropertyPriority(name), value]);
    element.style.setProperty(name, value);
  }
  if (doc.defaultView.getComputedStyle(element).position === 'static') setStyle('position', 'relative');
  setStyle('-webkit-touch-callout', 'none');
  setStyle('user-select', 'none');
  const badge = doc.createElement('div');
  badge.setAttribute('data-noah-sdk-product-controls', '');
  const shadow = styledShadow(doc, badge, `
    :host { position:absolute; right:10px; bottom:10px; z-index:2; }
    ${OA_BUTTON_CSS}
    button { width:46px; height:46px; padding:7px; } svg { width:30px; height:23px; }
  `, nonce);
  const trigger = oaButton(doc, 'Ações deste produto no Noah');
  shadow.append(trigger); element.append(badge);
  const radial = radialActions({ client, target: { targetType: 'PRODUCT', productId }, trigger, surface: element, controls: badge, documentObject: doc, nonce });
  let closed = false;
  return {
    open: radial.open,
    close() {
      if (closed) return; closed = true;
      radial.close(); badge.remove();
      for (const [name, [value, priority, assigned]] of previous) {
        if (element.style.getPropertyValue(name) === assigned) {
          if (value) element.style.setProperty(name, value, priority); else element.style.removeProperty(name);
        }
      }
    },
  };
}
