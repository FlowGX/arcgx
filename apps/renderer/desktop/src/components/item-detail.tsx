import { useEffect, useState } from 'preact/hooks';

import type { GameItem } from '@arcgx/shared';

const api = window.arcgx.desktop;

/** Detalhe cru do dump — tem mais campos que a linha do sqlite. */
interface RawDetail {
  id: string;
  name?: unknown;
  description?: unknown;
  type?: string;
  rarity?: string;
  value?: number;
  weightKg?: number;
  stackSize?: number;
  imageFilename?: string;
  updatedAt?: string;
  foundIn?: unknown;
  recyclesInto?: { id: string; qty: number }[] | Record<string, number>;
  salvagesInto?: { id: string; qty: number }[] | Record<string, number>;
  breaksInto?: { id: string; qty: number }[] | Record<string, number>;
  addedIn?: string;
  updatedBy?: string;
  _source?: string;
}

const texto = (v: unknown, locale = 'pt-BR'): string => {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, string>;
    return o[locale] ?? o['pt-BR'] ?? o.pt ?? o.en ?? Object.values(o).find((x) => !!x) ?? '';
  }
  return '';
};

/** Aceita as duas formas: array de `{id,qty}` ou mapa `{id: qty}`. */
function pares(v: unknown): { id: string; qty: number }[] {
  if (Array.isArray(v)) {
    return v
      .map((x) => ({ id: String(x?.id ?? ''), qty: Number(x?.qty ?? 1) }))
      .filter((x) => x.id);
  }
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, number>)
      .map(([id, qty]) => ({ id, qty: Number(qty) || 1 }))
      .filter((x) => x.id);
  }
  return [];
}

const TIER_LABEL: Record<string, string> = {
  common: 'Comum',
  uncommon: 'Incomum',
  rare: 'Raro',
  epic: 'Épico',
  legendary: 'Lendário',
  mythic: 'Mítico',
};

export function ItemDetail({
  item,
  locale,
  onClose,
}: {
  item: GameItem;
  locale?: string;
  onClose: () => void;
}) {
  const [raw, setRaw] = useState<RawDetail | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let alive = true;
    setRaw(null);
    setErro(false);
    void api
      .getItemDetail(item.id)
      .then((d: unknown) => {
        if (alive) setRaw((d as RawDetail) ?? null);
      })
      .catch(() => alive && setErro(true));
    return () => {
      alive = false;
    };
  }, [item.id]);

  const d = raw;
  const descricao = texto(d?.description, locale) || item.description || '';
  const lore = texto((d as unknown as { flavorText?: unknown })?.flavorText, locale);
  const recycle = pares(d?.recyclesInto);
  const salvage = pares(d?.salvagesInto);
  const quebra = pares(d?.breaksInto);

  // `foundIn` chega como string (container) ou lista de objetos
  const foundRaw = d?.foundIn;
  const found: string[] = Array.isArray(foundRaw)
    ? foundRaw.map((x) => (typeof x === 'string' ? x : texto((x as { name?: unknown })?.name, locale)))
        .filter(Boolean)
    : foundRaw
      ? [texto(foundRaw, locale)].filter(Boolean)
      : [];

  const arte = d?.imageFilename ?? item.imageUrl;

  return (
    <div class="card detail">
      <button type="button" class="btn ghost detail-close" onClick={onClose}>
        fechar
      </button>

      <div class="detail-hero">
        {arte ? (
          <img class="detail-art-big" src={arte} alt="" draggable={false} />
        ) : (
          <div class="detail-art-big fallback">?</div>
        )}
        <div style={{ minWidth: 0 }}>
          <div class="detail-name">{item.name}</div>
          <div class="muted" style={{ fontSize: 11, marginTop: 3 }}>
            {[item.category, TIER_LABEL[item.tier] ?? item.tier].filter(Boolean).join(' · ')}
          </div>
          <div class="muted mono" style={{ fontSize: 10, marginTop: 6 }}>
            {item.id}
          </div>
        </div>
      </div>

      <div class="detail-stats">
        <Stat k="Valor" v={fmt(item.baseValue ?? d?.value)} />
        <Stat k="Peso" v={d?.weightKg != null ? `${d.weightKg} kg` : '—'} />
        <Stat k="Pilha" v={String(d?.stackSize ?? item.stackSize ?? 1)} />
        {d?.updatedAt ? <Stat k="Atualizado" v={d.updatedAt} /> : null}
      </div>

      {descricao ? (
        <p class="detail-desc">{descricao}</p>
      ) : erro ? (
        <p class="muted">Não foi possível carregar o detalhe deste item.</p>
      ) : (
        <p class="muted">Sem descrição na base.</p>
      )}

      {lore ? <p class="detail-lore">{lore}</p> : null}

      {found.length ? (
        <Secao titulo="Onde encontrar">
          <div class="chips">
            {found.map((f) => (
              <span key={f} class="chip">
                {f}
              </span>
            ))}
          </div>
        </Secao>
      ) : null}

      {recycle.length ? (
        <Secao titulo="Recicla em">
          <Lista itens={recycle} />
        </Secao>
      ) : null}

      {salvage.length ? (
        <Secao titulo="Desmonta em">
          <Lista itens={salvage} />
        </Secao>
      ) : null}

      {quebra.length ? (
        <Secao titulo="Quebra em">
          <Lista itens={quebra} />
        </Secao>
      ) : null}

      <p class="detail-foot">
        Valor de referência da base pública, não preço de mercado entre jogadores: isso depende da
        plataforma de troca e do momento.
      </p>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: preact.ComponentChildren }) {
  return (
    <div class="detail-sec">
      <div class="detail-sec-t">{titulo}</div>
      {children}
    </div>
  );
}

function Lista({ itens }: { itens: { id: string; qty: number }[] }) {
  return (
    <div class="chips">
      {itens.map((i) => (
        <span key={i.id} class="chip">
          {i.id.replace(/_/g, ' ')}
          {i.qty > 1 ? ` ×${i.qty}` : ''}
        </span>
      ))}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div class="detail-stat">
      <div class="detail-stat-k">{k}</div>
      <div class="detail-stat-v">{v}</div>
    </div>
  );
}

function fmt(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n.toLocaleString('pt-BR');
}
