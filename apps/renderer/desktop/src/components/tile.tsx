import { useState } from 'preact/hooks';

import type { GameItem } from '@arcgx/shared';

/**
 * Raridade vem como `tier` já normalizado pelo indexador, mas o dump também
 * traz o rótulo em inglês. Aceitamos os dois para não depender de um só.
 */
const TIER_RARITY: Record<string, string> = {
  common: 'common',
  uncommon: 'uncommon',
  rare: 'rare',
  epic: 'epic',
  legendary: 'legendary',
  mythic: 'legendary',
};

/** `angled_grip_iii_blueprint` -> "III"; o games usa tier no sufixo do id. */
export function itemTier(id: string): string | null {
  const m = /_(i|ii|iii|iv)(?:_blueprint)?$/.exec(id);
  return m ? m[1]!.toUpperCase() : null;
}

export function itemKind(id: string): 'blueprint' | 'design' | null {
  if (id.endsWith('_blueprint')) return 'blueprint';
  if (id.endsWith('_design')) return 'design';
  return null;
}

export function rarityOf(item: GameItem): string {
  return TIER_RARITY[item.tier] ?? 'common';
}

export interface TileProps {
  item: GameItem;
  /** quantidade na pilha; omitir quando não for um tile de stash */
  qty?: number | null;
  /** ponto dourado: ainda é preciso para algo */
  needed?: boolean;
  /** some com a arte quando não há `imageUrl` */
  bare?: boolean;
}

/**
 * Um quadrado de item.
 *
 * A anatomia segue a referência: moldura 1:1, cunha de raridade no canto
 * inferior esquerdo, faixa de 3px na base e a arte occupant ~80% do quadro.
 * A raridade nunca preenche o quadrado inteiro — preenchendo, 105 itens
 * "comum" viram um bloco cinza sem forma de ler o que é o quê.
 */
export function Tile({ item, qty, needed, bare }: TileProps) {
  const [broken, setBroken] = useState(false);
  const kind = itemKind(item.id);
  const tier = itemTier(item.id);
  const showArt = !bare && !!item.imageUrl && !broken;

  return (
    <div
      class="gx-tile"
      data-rarity={rarityOf(item)}
      data-kind={kind ?? undefined}
      data-unknown={!item.imageUrl ? '' : undefined}
    >
      {showArt ? (
        <img
          class="gx-tile-img"
          src={item.imageUrl}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setBroken(true)}
        />
      ) : (
        <div class="gx-tile-fallback" aria-hidden="true">
          {kind === 'blueprint' ? '▦' : '?'}
        </div>
      )}

      {tier ? <span class="gx-tile-tier">{tier}</span> : null}
      {qty != null && Number.isFinite(qty) ? <span class="gx-tile-qty">×{qty}</span> : null}
      {needed ? <span class="gx-tile-pip" title="ainda necessário" /> : null}
    </div>
  );
}

/** Tile + nome + fatos, a célula da grade de itens. */
export function TileCell({
  item,
  onSelect,
  selected,
}: {
  item: GameItem;
  onSelect?: (item: GameItem) => void;
  selected?: boolean;
}) {
  const facts = (
    <div class="gx-tile-facts">
      {typeof item.baseValue === 'number' && item.baseValue > 0 ? (
        <span class="gx-tile-value">
          <span class="gx-coin" aria-hidden="true" />
          {item.baseValue.toLocaleString('pt-BR')}
        </span>
      ) : null}
    </div>
  );

  const body = (
    <>
      <Tile item={item} />
      <span class="gx-tile-label">{item.name}</span>
      {facts}
    </>
  );

  if (!onSelect) {
    return <div class="gx-cell">{body}</div>;
  }

  return (
    <button
      type="button"
      class="gx-cell"
      aria-pressed={selected}
      aria-label={item.name}
      onClick={() => onSelect(item)}
    >
      {body}
    </button>
  );
}
