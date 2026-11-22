import { createNoahCompanyClient } from '__NOAH_COMPANY_SDK_MODULE__';


const INSTALLATION_URL = './template-installation.json';
const GENERIC_ERROR = 'Não foi possível carregar o catálogo Noah agora. Tente novamente mais tarde.';


function requiredElement(documentObject, id) {
  const element = documentObject.getElementById(id);
  if (!element) throw new Error(`Missing starter element: ${id}`);
  return element;
}


export function createDomView(documentObject) {
  const root = documentObject.documentElement;
  const title = requiredElement(documentObject, 'company-name');
  const unit = requiredElement(documentObject, 'unit-label');
  const status = requiredElement(documentObject, 'connection-status');
  const error = requiredElement(documentObject, 'error-panel');
  const empty = requiredElement(documentObject, 'empty-state');
  const products = requiredElement(documentObject, 'products');
  const openNoah = requiredElement(documentObject, 'open-noah');

  return {
    setTheme(theme) { root.dataset.theme = theme; },
    setUnit(label) { unit.textContent = label; },
    setCompany(company) { title.textContent = company.tradeName || company.legalName; },
    setConnection(state, message) {
      status.dataset.state = state;
      status.textContent = message;
    },
    showError(message) {
      error.textContent = message;
      error.hidden = false;
    },
    showCatalog(entries, onOpen) {
      products.replaceChildren();
      error.hidden = true;
      empty.hidden = entries.length !== 0;
      for (const entry of entries) {
        const card = documentObject.createElement('article');
        card.className = 'product-card';

        const heading = documentObject.createElement('h3');
        heading.textContent = entry.product.name;
        card.append(heading);

        if (entry.product.brand) {
          const brand = documentObject.createElement('p');
          brand.className = 'product-meta';
          brand.textContent = entry.product.brand;
          card.append(brand);
        }

        const observation = documentObject.createElement('p');
        observation.className = 'product-observation';
        observation.textContent = `Preço fiscal observado em ${entry.observedOn}: R$ ${entry.observedUnitPrice}`;
        card.append(observation);

        const availability = documentObject.createElement('p');
        availability.className = 'product-availability';
        availability.textContent = 'Disponibilidade atual não confirmada.';
        card.append(availability);

        const button = documentObject.createElement('button');
        button.type = 'button';
        button.className = 'product-action';
        button.textContent = 'Ver no Noah';
        button.addEventListener('click', () => {
          Promise.resolve(onOpen(entry.product.id)).catch(() => this.showError(GENERIC_ERROR));
        });
        card.append(button);
        products.append(card);
      }
    },
    setOpenNoah(visible, onOpen) {
      openNoah.hidden = !visible;
      openNoah.onclick = visible
        ? () => { Promise.resolve(onOpen()).catch(() => this.showError(GENERIC_ERROR)); }
        : null;
    },
  };
}


async function loadInstallation(fetchImpl, installationUrl) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable.');
  const response = await fetchImpl(installationUrl, { cache: 'no-store', credentials: 'omit' });
  if (!response?.ok) throw new Error('Installation configuration is unavailable.');
  return response.json();
}


export async function bootRetailPickup({
  documentObject = globalThis.document,
  windowObject = globalThis.window,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  clientFactory = createNoahCompanyClient,
  installationUrl = INSTALLATION_URL,
  view = documentObject ? createDomView(documentObject) : null,
} = {}) {
  if (!view) throw new Error('A view or document is required.');
  let client = null;
  let stopTheme = null;
  let pagehideAttached = false;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    if (pagehideAttached) windowObject?.removeEventListener?.('pagehide', close);
    try { stopTheme?.(); } catch { /* teardown remains best effort */ }
    try { client?.close(); } catch { /* teardown remains best effort */ }
  };

  view.setOpenNoah(false, null);
  view.setConnection('loading', 'Conectando ao catálogo Noah…');

  try {
    const installation = await loadInstallation(fetchImpl, installationUrl);
    const companySlug = installation.experienceOwner.companySlug;
    view.setTheme(installation.appearance.defaultTheme);
    view.setUnit(installation.scope.unitLabel);

    client = clientFactory({
      noahOrigin: installation.noah.origin,
      companySlug,
      mode: 'auto',
      windowObject,
    });
    const context = await client.connect();
    if (context.companySlug !== companySlug) throw new Error('Company context mismatch.');
    if (context.mode === 'embedded') {
      view.setTheme(context.theme);
      stopTheme = client.onTheme((theme) => view.setTheme(theme));
    }

    const [profile, page] = await Promise.all([
      client.getCompanyProfile(),
      client.listObservedProducts({ limit: 24 }),
    ]);
    if (profile.slug !== companySlug || page.company?.slug !== companySlug) {
      throw new Error('Company projection mismatch.');
    }

    view.setCompany(profile);
    view.showCatalog(page.products, (productId) => client.openProduct(productId));
    view.setOpenNoah(context.mode === 'standalone', () => client.openNoahMenu());
    view.setConnection(
      'ready',
      page.products.length ? 'Catálogo Noah atualizado.' : 'Nenhum produto observado disponível.',
    );
    windowObject?.addEventListener?.('pagehide', close);
    pagehideAttached = true;
    return { status: 'ready', mode: context.mode, close };
  } catch {
    close();
    view.setOpenNoah(false, null);
    view.setConnection('error', 'Catálogo temporariamente indisponível.');
    view.showError(GENERIC_ERROR);
    return { status: 'error', mode: null, close };
  }
}


if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  void bootRetailPickup();
}
