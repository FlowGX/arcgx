/**
 * Schema dos dados do jogo publicados no data-release.
 *
 * Formato derivado dos assets públicos do jogo (nomes localizados, raridade,
 * valor, containers, quests). Cada arquivo é um JSON único e versionado pelo
 * `version`/`schema` do próprio topo.
 *
 * Ver `tools/data-publisher/README.md` para como gerar e publicar.
 */

/** Texto por idioma. Chave ausente = idioma não traduzido. */
export type LocalizedText = Record<string, string>;

export const SUPPORTED_LOCALES = [
  'en',
  'pt-BR',
  'pt',
  'es',
  'fr',
  'de',
  'it',
  'ru',
  'pl',
  'tr',
  'uk',
  'zh-CN',
  'zh-TW',
  'ja',
  'ko-KR',
  'ar',
  'he',
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const FALLBACK_LOCALE: Locale = 'en';

/** Ordem canônica: en -> pt-BR -> raiz do idioma -> en. */
const localeChain = (locale: string): string[] => {
  const chain = [locale];
  const base = locale.split('-')[0] ?? locale;
  if (base !== locale) chain.push(base);
  if (!chain.includes(FALLBACK_LOCALE)) chain.push(FALLBACK_LOCALE);
  return chain;
};

/** Resolve o melhor texto disponível para um idioma. */
export function resolveText(
  text: LocalizedText | string | undefined | null,
  locale: string = FALLBACK_LOCALE,
  fallback = '',
): string {
  if (!text) return fallback;
  if (typeof text === 'string') return text;
  for (const key of localeChain(locale)) {
    const value = text[key];
    if (value) return value;
  }
  for (const value of Object.values(text)) {
    if (value) return value;
  }
  return fallback;
}

/* ------------------------------------------------------------------- tier */

/** Tiers do Arc GX, do mais comum ao mais raro. */
export type Tier = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

export const TIER_ORDER: readonly Tier[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

/** Raridades do jogo -> tiers do Arc GX. A ordem define o valor de mercado. */
export const RARITY_TO_TIER: Record<string, Tier> = {
  Common: 'common',
  Uncommon: 'uncommon',
  Rare: 'rare',
  Epic: 'epic',
  Legendary: 'legendary',
  Mythic: 'mythic',
};

export function toTier(rarity: string | undefined | null): Tier {
  if (!rarity) return 'common';
  const hit = Object.keys(RARITY_TO_TIER).find((r) => r.toLowerCase() === rarity.toLowerCase());
  return hit ? (RARITY_TO_TIER[hit] as Tier) : 'common';
}

/* ------------------------------------------------------------------ itens */

/** Item como vem no `items.json` — nomes brutos, ainda por idioma. */
export interface RawGameItem {
  id: string;
  name: LocalizedText;
  description?: LocalizedText;
  /** categoria de gameplay (weapon, armor, resource, ...) */
  type: string;
  /** raridade crua do jogo: Common | Uncommon | ... */
  rarity: string;
  /** valor de referência em moeda do jogo */
  value: number;
  weightKg?: number;
  stackSize?: number;
  imageFilename?: string;
  /** build do jogo em que o item apareceu pela primeira vez */
  addedIn?: string;
  updatedAt?: string;
  repairCost?: number;
  repairDurability?: number;
  recyclesInto?: { id: string; qty: number }[];
  salvagesInto?: { id: string; qty: number }[];
  mechanics?: Record<string, unknown>;
}

export interface ItemsFile {
  version: number;
  generatedAt: string;
  itemCount: number;
  items: Record<string, RawGameItem>;
}

/* ------------------------------------------------------------- containers */

export interface Container {
  id: string;
  name: LocalizedText;
  kind: string;
  category?: string;
  breach?: string;
  maps?: string[];
  /** itens possíveis (ids) */
  items?: string[];
  /** eventos de loot */
  events?: string[];
  practiceRange?: boolean;
  sameLootAcrossVersions?: boolean;
}

export interface ContainersFile {
  build: number;
  buildLabel?: string;
  containers: Record<string, Container>;
  /** tabela id -> { weight, items: [{ id, weight, qty }] } */
  tables?: Record<string, unknown>;
  handlers?: Record<string, unknown>;
  skills?: Record<string, unknown>;
  items?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ quests */

export interface Quest {
  id: string;
  name: LocalizedText;
  description?: LocalizedText;
  kind?: string;
  /** ids de itens exigidos/recompensa */
  objectives?: { itemId: string; qty: number; kind?: string }[];
  rewards?: { itemId: string; qty: number }[];
  maps?: string[];
  unlockedBy?: string[];
}

export interface QuestsFile {
  version: number;
  generatedAt: string;
  totalQuests: number;
  quests: Record<string, Quest>;
}

/* ----------------------------------------------------------- progressão */

export interface ResearchFile {
  schema: number;
  station: string;
  maxLevel: number;
  points: number;
  researches: Record<string, unknown>;
  aliases?: Record<string, unknown>;
}

export interface SkillNodesFile {
  version: number;
  generatedAt: string;
  totalSkillNodes: number;
  skillNodes: Record<string, unknown>;
  tree?: unknown;
}

export interface ProjectsFile {
  version: number;
  generatedAt: string;
  totalProjects: number;
  projects: Record<string, unknown>;
}

export interface OutpostsFile {
  schema: number;
  track?: string;
  rooms?: unknown;
  slotTypes?: unknown;
  furniture?: unknown;
}

export interface ExtractionsFile {
  maps: Record<string, unknown>;
  kinds: Record<string, unknown>;
}

export interface BlueprintsFile {
  count: number;
  blueprints: Record<string, unknown>;
}

export interface ItemUsageFile {
  version: number;
  generatedAt: string;
  itemCount: number;
  /** itemId -> onde o item aparece (loot, recipe, quest, ...) */
  usage: Record<string, { sources?: { kind: string; id: string; qty?: number }[] }>;
}

/* -------------------------------------------------------------- o registro */

export interface GameDataBundle {
  items: ItemsFile | null;
  containers: ContainersFile | null;
  quests: QuestsFile | null;
  research: ResearchFile | null;
  skillNodes: SkillNodesFile | null;
  projects: ProjectsFile | null;
  outposts: OutpostsFile | null;
  extractions: ExtractionsFile | null;
  blueprints: BlueprintsFile | null;
  itemUsage: ItemUsageFile | null;
}

/**
 * Créditos de fonte de dados.
 *
 * O data-ingest gera `ATTRIBUTION.json` com uma entrada por fonte. Quando
 * `required === true`, o app **precisa** renderizar `notice` e `link` — é a
 * condição da licença daquele dado.
 */
export interface DataAttribution {
  id: string;
  name: string;
  homepage: string;
  license: string;
  /** Quando true, a tela de créditos é obrigatória e não pode ser escondida. */
  required: boolean;
  /** Texto a exibir. */
  notice: string;
  /** URL a exibir e abrir. */
  link: string;
  /** Link do projeto original da fonte, quando a licença exige citar. */
  projectLink?: string;
  /** Rights do conteúdo do jogo — sempre ≠ nossos. */
  dataCopyright: string;
}

export interface AttributionFile {
  generatedAt: string;
  sources: DataAttribution[];
}

export const GAME_DATA_FILES = [
  'game/items.json',
  'game/containers.json',
  'game/quests.json',
  'game/research.json',
  'game/skill-nodes.json',
  'game/projects.json',
  'game/outposts.json',
  'game/extractions.json',
  'game/blueprints.json',
  'game/item-usage.json',
] as const;

export type GameDataFile = (typeof GAME_DATA_FILES)[number];