export type NoahTheme = 'light' | 'dark' | 'system';

export interface PublicCompanyProfile {
  id: string;
  slug: string;
  cnpj: string | null;
  legalName: string;
  tradeName: string | null;
  phone: string | null;
  address: { street: string | null; number: string | null; district: string | null; city: string | null; state: string | null; postalCode: string | null };
  coordinates: { latitude: number; longitude: number } | null;
  locationVerified: boolean;
  status: 'UNCLAIMED' | 'CLAIMED';
}

/** The public Noah catalog projection. Prices are observed fiscal prices, never live offers. */
export interface ObservedCompanyPage {
  company: { id: string; slug: string; legalName: string; tradeName: string | null };
  products: Array<{
    product: { id: string; name: string; gtin: string | null; imageUrl: string | null; brand: string | null };
    observedUnitPrice: string;
    observedOn: string;
    observationCount: number;
    availability: 'NOT_CONFIRMED';
  }>;
  page: { nextCursor: string | null };
}

/** Shape accepted from Noah's existing public company catalog endpoint. */
export interface PublicCompanyCatalogInput {
  company: { id: string; slug: string; legalName: string; tradeName: string | null } & Partial<PublicCompanyProfile>;
  products: Array<{
    product: { id: string; name: string; gtin: string | null; imageUrl: string | null; brand: string | null };
    unitPrice: string;
    observedOn: string;
    observationCount: number;
  }>;
  page: { nextCursor: string | null };
}

export interface MiniappContext {
  companySlug: string;
  theme: NoahTheme;
  capabilities: string[];
}

export interface MiniappClient {
  connect(): Promise<MiniappContext>;
  getCompanyProfile(): Promise<PublicCompanyProfile>;
  openOpinionComposer(target: { targetType: 'PRODUCT' | 'COMPANY'; targetId: string }): Promise<{ opened: true }>;
  openNoahMenu(target?: { targetType: 'PRODUCT' | 'COMPANY'; targetId: string }): Promise<{ opened: true }>;
  openSocialActions(target: { targetType: 'PRODUCT' | 'COMPANY'; targetId: string; intent: 'LIKE' | 'FOLLOW' }): Promise<{ opened: true }>;
  setControlsMounted(mounted: boolean): Promise<{ mounted: boolean }>;
  listObservedProducts(options?: { cursor?: string; limit?: number }): Promise<ObservedCompanyPage>;
  openProduct(productId: string): Promise<{ opened: true }>;
  onTheme(callback: (theme: NoahTheme) => void): () => void;
  close(): void;
}

/** One company webapp API, whether it is embedded or accessed on its own domain. */
export interface CompanyAppContext extends MiniappContext {
  mode: 'embedded' | 'standalone';
}

export interface PublishedCompanyPage {
  company: { id: string; slug: string };
  items: Array<{
    productId: string;
    revision: number;
    content: {
      title: string;
      description: string;
      category: string | null;
      collections: string[];
      media: Array<{ url: string; sourceUrl: string; license: string; alt: string }>;
      provenance: { title: string; description: string; category: string | null; collections: string | null };
    };
  }>;
  page: { nextCursor: string | null };
}

/** Native identity and company declaration; itemId is not a Product Graph productId. */
export interface CompanyCatalogItem {
  itemId: string;
  revision: number;
  source: 'COMPANY_DECLARATION';
  content: {
    kind: 'PRODUCT' | 'SERVICE' | 'MENU_ITEM';
    sku: string | null;
    title: string;
    description: string;
    category: string | null;
    collections: string[];
    media: Array<{ url: string; sourceUrl: string | null; license: string; alt: string }>;
  };
}

export interface CompanyCatalogPage {
  company: { id: string; slug: string };
  items: CompanyCatalogItem[];
  page: { nextCursor: string | null };
}

export interface CompanyCatalogItemResponse {
  company: { id: string; slug: string };
  item: CompanyCatalogItem;
}

export interface PublicOpinion {
  id: string;
  targetType: 'PRODUCT' | 'COMPANY';
  targetId: string;
  targetName: string;
  revision: number;
  authorLabel: string;
  recommendation: 'RECOMMEND' | 'NOT_RECOMMEND' | 'MIXED';
  text: string;
  proofLabel: 'INVOICE_PRESENTED';
  createdAt: string;
  updatedAt: string;
  citationPath: string;
}

export interface OpinionPage {
  targetType: 'PRODUCT' | 'COMPANY';
  targetId: string;
  items: PublicOpinion[];
  summary: { total: number; recommend: number; notRecommend: number; mixed: number };
  page: { nextCursor: string | null };
}

export interface OpinionQuery {
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface CompanyAppClient {
  connect(): Promise<CompanyAppContext>;
  getCompanyProfile(): Promise<PublicCompanyProfile>;
  listCompanyOpinions(options?: OpinionQuery): Promise<OpinionPage>;
  listProductOpinions(productId: string, options?: OpinionQuery): Promise<OpinionPage>;
  openOpinionComposer(target: { targetType: 'PRODUCT' | 'COMPANY'; productId?: string }): Promise<{ opened: true }>;
  openNoahMenu(target?: { targetType: 'PRODUCT' | 'COMPANY'; productId?: string }): Promise<{ opened: true }>;
  openSocialActions(target: { targetType?: 'PRODUCT' | 'COMPANY'; productId?: string; intent: 'LIKE' | 'FOLLOW' }): Promise<{ opened: true }>;
  getReactionSummary(target?: { targetType?: 'PRODUCT' | 'COMPANY'; productId?: string }): Promise<{ followers: number; likes: number }>;
  setControlsMounted(mounted: boolean): Promise<{ mounted: boolean }>;
  listObservedProducts(options?: { cursor?: string; limit?: number }): Promise<ObservedCompanyPage>;
  listPublishedProducts(options?: { cursor?: string; limit?: number }): Promise<PublishedCompanyPage>;
  listCompanyItems(options?: { cursor?: string; limit?: number }): Promise<CompanyCatalogPage>;
  getCompanyItem(itemId: string): Promise<CompanyCatalogItemResponse>;
  openProduct(productId: string): Promise<{ opened: true }>;
  onTheme(callback: (theme: NoahTheme) => void): () => void;
  close(): void;
}

export function createNoahCompanyClient(options: {
  noahOrigin: string;
  companySlug: string;
  mode?: 'auto' | 'embedded' | 'standalone';
  windowObject?: Window;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): CompanyAppClient;

export function createNoahMiniappClient(options: {
  noahOrigin: string;
  windowObject?: Window;
  timeoutMs?: number;
}): MiniappClient;

export interface MiniappHost {
  setTheme(theme: NoahTheme): void;
  close(): void;
}

export function mountNoahMiniappHost(options: {
  frame: HTMLIFrameElement;
  appOrigin: string;
  companySlug: string;
  listObservedProducts: (companySlug: string, options: { cursor?: string; limit: number }) => Promise<PublicCompanyCatalogInput>;
  openProduct: (productId: string) => void | Promise<void>;
  openOpinion?: (target: { targetType: 'PRODUCT' | 'COMPANY'; targetId: string }) => void | Promise<void>;
  openMenu?: (target: { targetType: 'PRODUCT' | 'COMPANY'; targetId: string }) => void | Promise<void>;
  openSocialActions?: (target: { targetType: 'PRODUCT' | 'COMPANY'; targetId: string; intent: 'LIKE' | 'FOLLOW' }) => void | Promise<void>;
  onControlsChange?: (mounted: boolean) => void;
  theme?: NoahTheme;
  windowObject?: Window;
}): MiniappHost;

export function mountNoahControls(options: {
  client: CompanyAppClient;
  noahOrigin: string;
  container?: HTMLElement;
  bottomOffset?: number;
  nonce?: string;
  documentObject?: Document;
}): Promise<{ close(): void }>;

/** Image wrapper, never an inferred local catalog identity. Restores its styles on close. */
export function mountNoahProductActions(options: {
  client: CompanyAppClient;
  noahOrigin: string;
  element: HTMLElement;
  productId: string;
  nonce?: string;
}): { open(): void; close(): void };
