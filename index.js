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
    || typeof company.cnpj !== 'string' || !/^\d{14}$/.test(company.cnpj)
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

/** Optional floating controls. All authenticated actions open Noah's own interface. */
export async function mountNoahControls({
  client, noahOrigin, container, bottomOffset = 88, nonce, documentObject = document,
}) {
  const origin = originOf(noahOrigin);
  if (!Number.isInteger(bottomOffset) || bottomOffset < 0 || bottomOffset > 300) {
    throw new TypeError('Invalid controls offset.');
  }
  const context = await client.connect();
  const element = documentObject.createElement('div');
  element.setAttribute('data-noah-sdk-controls', '');
  const shadow = element.attachShadow({ mode: 'open' });
  const style = documentObject.createElement('style');
  if (nonce) style.nonce = nonce;
  style.textContent = `
    :host { position:fixed; right:12px; bottom:calc(${bottomOffset}px + env(safe-area-inset-bottom, 0px)); z-index:1000; }
    nav { display:flex; align-items:center; gap:6px; padding:6px; border:1px solid #dbe2ea; border-radius:28px; background:#fff; box-shadow:0 4px 20px #0f172a26; font:600 12px system-ui,sans-serif; }
    button { min-height:40px; border:0; border-radius:20px; padding:8px 12px; background:#fff; color:#172554; cursor:pointer; font:inherit; }
    button:hover { background:#eff6ff; } button:focus-visible { outline:3px solid #2563eb; }
    img { width:28px; height:28px; display:block; } .brand { padding:6px; }
    p { max-width:240px; margin:6px 0 0; padding:6px; background:#fff; color:#991b1b; }
    p:empty { display:none; }
  `;
  shadow.append(style);
  const nav = documentObject.createElement('nav');
  nav.setAttribute('aria-label', 'Controles do Noah');
  const status = documentObject.createElement('p');
  status.setAttribute('role', 'status');
  const handlers = [];
  function button(label, action) {
    const control = documentObject.createElement('button');
    control.type = 'button';
    control.textContent = label;
    control.setAttribute('aria-label', label);
    const click = async () => {
      control.disabled = true;
      status.textContent = '';
      try { await action(); } catch { status.textContent = 'Não foi possível abrir o Noah. Tente novamente.'; }
      finally { control.disabled = false; }
    };
    control.addEventListener('click', click);
    handlers.push(() => control.removeEventListener('click', click));
    nav.append(control);
    return control;
  }
  const brand = button(context.mode === 'embedded' ? 'Menu Noah' : 'Abrir o Noah', () => client.openNoahMenu());
  brand.className = 'brand';
  brand.textContent = '';
  const icon = documentObject.createElement('img');
  icon.src = new URL('/icons/icon.svg', origin).href;
  icon.alt = 'Noah';
  brand.append(icon);
  button('Seguir', () => client.openSocialActions({ targetType: 'COMPANY', intent: 'FOLLOW' }));
  button('Curtir', () => client.openSocialActions({ targetType: 'COMPANY', intent: 'LIKE' }));
  shadow.append(nav, status);
  (container ?? documentObject.body).append(element);
  try { await client.setControlsMounted(true); }
  catch { element.remove(); throw new Error('Noah não confirmou os controles da página.'); }
  return {
    close() {
      handlers.forEach((remove) => remove());
      element.remove();
      void client.setControlsMounted(false).catch(() => {});
    },
  };
}
