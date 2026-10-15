/**
 * Verificação de atualização do jogo.
 *
 * O jogo publica patch notes; a MetaForge publica os eventos que aparecem
 * junto com cada patch. O app compara o que já está na release com o que a
 * API devolve agora e, havendo diferença, **pergunta** — não atualiza sozinho.
 *
 * Perguntar em vez de atualizar é deliberado: conteúdo novo que ninguém
 * revisou costuma vir com metade dos ícones, e um classificador de ícone com
 * galeria pela metade erra mais do que um classificador desatualizado.
 */

const BASE = 'https://metaforge.app/api/arc-raiders';

export interface GameUpdate {
  /** fingerprint do conteúdo atual no app */
  seen: string;
}

export interface UpdateCheck {
  /** há algo que o app não viu */
  hasUpdate: boolean;
  /** o que apareceu de novo, em texto */
  added: string[];
  /** o que sumiu do catálogo */
  removed: string[];
  /** amostra do que mudou dentro dos itens já conhecidos */
  changed: { id: string; nome: string; campos: string[] }[];
  /** contagens, para o texto não depender da lista inteira */
  totals: { local: number; remoto: number };
  /** quando foi checado */
  checkedAt: number;
}

/** Assinatura barata do catálogo: quantos itens e a arte do primeiro e do último. */
export function fingerprint(items: Record<string, unknown> | undefined | null): string {
  if (!items) return 'vazio';
  const ids = Object.keys(items).sort();
  const primeiro = ids[0] ?? '';
  const ultimo = ids[ids.length - 1] ?? '';
  return `${ids.length}:${primeiro}:${ultimo}`;
}

/**
 * Compara o catálogo local com o remoto.
 *
 * Recebe os dois já carregados para não repetir request: a checagem é
 * periódica, não por aba.
 */
export function comparar(
  local: Record<string, unknown>,
  remoto: Record<string, unknown>,
): Omit<UpdateCheck, 'checkedAt'> {
  const localIds = new Set(Object.keys(local));
  const remotoIds = new Set(Object.keys(remoto));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: { id: string; nome: string; campos: string[] }[] = [];

  for (const id of remotoIds) if (!localIds.has(id)) added.push(id);
  for (const id of localIds) if (!remotoIds.has(id)) removed.push(id);

  // amostra: comparar 1.100 itens inteiros a cada checagem é caro à toa
  const amostra = [...remotoIds].slice(0, 400);
  for (const id of amostra) {
    const a = local[id] as Record<string, unknown> | undefined;
    const b = remoto[id] as Record<string, unknown> | undefined;
    if (!a || !b) continue;

    const campos: string[] = [];
    for (const campo of ['value', 'type', 'rarity', 'imageFilename', 'stackSize', 'weightKg']) {
      if (a[campo] !== b[campo]) campos.push(campo);
    }
    if (campos.length) {
      const nome = b.name;
      changed.push({
        id,
        nome:
          typeof nome === 'string'
            ? nome
            : ((nome as Record<string, string> | undefined)?.en ?? id),
        campos,
      });
    }
  }

  return {
    hasUpdate: added.length > 0 || removed.length > 0 || changed.length > 0,
    added: added.slice(0, 60),
    removed: removed.slice(0, 60),
    changed: changed.slice(0, 40),
    totals: { local: localIds.size, remoto: remotoIds.size },
  };
}

/** Catálogo remoto enxuto: só o necessário para comparar. */
export async function catalogoRemoto(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (let page = 1; page <= 23; page++) {
    const r = await fetch(`${BASE}/items?page=${page}&limit=100`);
    if (!r.ok) break;
    const j = (await r.json()) as {
      data?: Record<string, unknown>[];
      pagination?: { hasNextPage?: boolean };
    };
    const rows: Record<string, unknown>[] = Array.isArray(j) ? j : (j.data ?? []);
    if (!rows.length) break;
    for (const it of rows) {
      const id = String(it.id ?? '');
      if (!id) continue;
      out[id] = {
        name: it.name,
        value: it.value,
        type: it.item_type,
        rarity: it.rarity,
        imageFilename: it.icon,
        stackSize: it.stack_size,
        weightKg: it.weight,
      };
    }
    if (j.pagination?.hasNextPage === false) break;
  }
  return out;
}

/** Texto curto que resume a checagem, para notificação e para o painel. */
export function descrever(c: UpdateCheck): string {
  if (!c.hasUpdate) return 'Nenhuma novidade no catálogo do jogo.';
  const partes: string[] = [];
  if (c.added.length) partes.push(`${c.added.length}+ item(ns) novo(s)`);
  if (c.removed.length) partes.push(`${c.removed.length} removido(s)`);
  if (c.changed.length) partes.push(`${c.changed.length} com campos alterados`);
  return `${partes.join(', ')}. Catálogo local tem ${c.totals.local}; a fonte reporta ${c.totals.remoto}.`;
}
