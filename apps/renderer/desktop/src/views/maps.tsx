import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { idioma, norm, txt, useColecao } from '../lib/data';
import { mapaDoEvento, nomeEvento, nomeGrupo, nomeSub as subI18n } from '@arcgx/shared/i18n';
import { Vazio } from './quests';

const api = window.arcgx.desktop;

/* --------------------------------------------------------------- tiles */

/**
 * ## Estrutura real da pirâmide (medida, não presumida)
 *
 * A CDN serve **duas bandas por zoom**, não por resolução:
 *
 * ```text
 *   low   z0 (1 tile)   z1 (4 tiles)      -> 2048px de lado
 *   high  z2 (4 tiles)  z3 (16 tiles)     -> 8192px de lado
 *   z4+  não existe
 * ```
 *
 * Descobrir isso na base de tentativa-e-erro evitou dois defeitos: pedir
 * `high` em z0 dava 404 (mapa preto) e deixar `maxZoom` em 3 sem as duas
 * camadas fazia o nível 2 nunca carregar.
 *
 * É *hotlink*, não cópia: nada da arte entra no app.
 */
const CDN = 'https://cdn.arctracker.io/maps/tiles';

const Z_MAX = 3;

/**
 * Slug por id. Nosso release usa `snake_case`; a CDN, `kebab-case`.
 *
 * Stella Montis **não** tem entrada aqui de propósito. O slug existia, a CDN
 * devolvia 404 em todos os níveis, e o mapa abria preto com a camada ligada
 * e o contador mostrando 3.101 pontos — o pior dos dois mundos. Testar os
 * dez slugs prováveis (`stella-montis-upper`, `stellaMontis`, `stella`, …)
 * não mudou nada: a arte simplesmente não está publicada
 * (`tools/check-stella-slugs.mjs`).
 *
 * Sem tiles, o app mostra o estado honesto e mantém os marcadores listados no
 * painel lateral. Preferível a fingir que o mapa carregou.
 */
const SLUG: Record<string, string> = {
  dam_battlegrounds: 'dam-battleground',
  the_spaceport: 'the-spaceport',
  buried_city: 'buried-city',
  the_blue_gate: 'blue-gate',
  riven_tides: 'riven-tides',
  pendola_pass: 'pendola-pass',
};

/**
 * Rótulo de piso.
 *
 * `stella_montis_upper` e `stella_montis_lower` trazem o MESMO nome traduzido
 * nos dados — "Stella Montis" duas vezes, indistinguível. O sufixo do id é a
 * única informação que separa os dois andares.
 */
const ANDAR: Record<string, string> = {
  stella_montis_upper: 'Stella Montis — superfície',
  stella_montis_lower: 'Stella Montis — subsolo',
  pendola_pass: 'Passagem Pendola',
  riven_tides: 'Marés Partidas',
  buried_city: 'Cidade Soterrada',
  the_spaceport: 'Espaçoporto',
  the_blue_gate: 'Portão Azul',
  dam_battlegrounds: 'Campos de Batalha da Represa',
};

/* ------------------------------------------------------------- marcadores */

/**
 * Grupos do marcador, com a forma e a cor que a UI desenha.
 *
 * O nome vem do dicionário compartilhado (`nomeGrupo`) quando o idioma não é
 * pt-BR; a lista local guarda cor e forma, que não têm tradução.
 *
 * ## ## ## Por que esta lista e o dicionário do `i18n` convivem
 *
 * O dicionário sabe os 7 nomes; esta lista sabe a cor de cada um e se é
 * círculo, losango ou triângulo. Juntar as duas coisas aqui duplicaria a
 * tabela de nomes em dois lugares, e foi o que aconteceu antes: um
 * `ROTULO_SUB` local com 7 das 182 entradas, e as outras 175 vazando em
 * `snake_case` na tela.
 */
interface GrupoDef {
  id: string;
  nome: string;
  cor: string;
  forma: 'circulo' | 'losango' | 'triangulo' | 'quadrado' | 'losango-furo';
}

const GRUPOS: GrupoDef[] = [
  { id: 'containers', nome: 'Contêineres', cor: '#e0b64a', forma: 'quadrado' },
  { id: 'arc', nome: 'Máquinas ARC', cor: '#d2504c', forma: 'losango' },
  { id: 'nature', nome: 'Natureza', cor: '#5aa96a', forma: 'circulo' },
  { id: 'locations', nome: 'Locais', cor: '#4a90d9', forma: 'circulo' },
  { id: 'events', nome: 'Eventos', cor: '#a86fd2', forma: 'triangulo' },
  { id: 'quests', nome: 'Missões', cor: '#38b6c4', forma: 'losango-furo' },
];

/** Forma em SVG para o desenho no canvas do Leaflet. */
function pathForma(forma: GrupoDef['forma'], r: number): string {
  switch (forma) {
    case 'losango':
      return `M0 ${-r}L${r} 0L0 ${r}L${-r} 0Z`;
    case 'losango-furo':
      return `M0 ${-r}L${r} 0L0 ${r}L${-r} 0ZM0 ${-r * 0.45}L${-r * 0.45} 0L0 ${r * 0.45}L${r * 0.45} 0Z`;
    case 'triangulo':
      return `M0 ${-r}L${r * 0.92} ${r * 0.72}L${-r * 0.92} ${r * 0.72}Z`;
    case 'quadrado':
      return `M${-r * 0.8} ${-r * 0.8}L${r * 0.8} ${-r * 0.8}L${r * 0.8} ${r * 0.8}L${-r * 0.8} ${r * 0.8}Z`;
    default:
      return `M${-r} 0A${r} ${r} 0 1 0 ${r} 0A${r} ${r} 0 1 0 ${-r} 0Z`;
  }
}

/* ------------------------------------------------------------------ dados */

interface MapaColunar {
  mapId: string;
  total: number;
  cols: string[];
  groups: string[];
  subs: string[];
  rows: [number, number, number, number, number][];
}

interface RawMarcadores {
  totalMarkers?: number;
  maps?: Record<string, MapaColunar>;
}

interface RawMap {
  id?: string;
  name?: unknown;
  displayName?: unknown;
}

interface Occ {
  start: number;
  end: number;
  map: string;
}
interface LiveEvent {
  id: string;
  name: string;
  map: string;
  icon?: string;
  current?: Occ;
  next?: Occ;
}

function chave(s: string): string {
  return norm(s).replace(/\s+/g, '');
}

/**
 * Nome do grupo no idioma atual.
 *
 * O rotulo local serve de fallback: ele e mais bonito que o `id` cru para
 * quem escrever uma tabela nova e esquecer a traducao.
 */
const rotuloGrupo = (g: GrupoDef): string => nomeGrupo(g.id, idioma()) || g.nome;

/** Nome da subcategoria, tambem com fallback legivel. */
const rotuloSub = (s: string): string => subI18n(s, idioma()) || s.replace(/_/g, ' ');

/* -------------------------------------------------------------------- ui */

export function MapsPage() {
  const { rows: lista, erro } = useColecao<RawMap>('maps.json', 'maps');
  const { rows: marcadorRaw } = useColecao<unknown>('map-markers.json', 'maps');
  const [ativo, setAtivo] = useState<string | null>(null);
  const [evs, setEvs] = useState<LiveEvent[]>([]);
  const [busca, setBusca] = useState('');
  const [camadas, setCamadas] = useState<Record<string, boolean>>(
    Object.fromEntries(GRUPOS.map((g) => [g.id, true])),
  );
  const [contando, setContando] = useState(false);

  const marcadores = (marcadorRaw?.[0] as unknown as RawMarcadores | undefined) ?? null;

  useEffect(() => {
    let vivo = true;
    const aplicar = (s: unknown) => {
      const snap = s as { aoVivo?: LiveEvent[] };
      if (vivo && snap?.aoVivo) setEvs(snap.aoVivo);
    };
    void api.eventsSnapshot().then(aplicar).catch(() => {});
    const off = api.onEventsSnapshot(aplicar);
    return () => {
      vivo = false;
      off();
    };
  }, []);

  const eventosPorChave = useMemo(() => {
    const m = new Map<string, LiveEvent[]>();
    for (const e of evs) {
      const k = chave(e.map);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return m;
  }, [evs]);

  const mapas = useMemo(() => {
    const arr = (lista ?? []).map((m) => {
      const id = String(m.id ?? '');
      const traduzido = String(m.displayName ?? txt(m.name) ?? id);
      return {
        id,
        nome: ANDAR[id] ?? traduzido,
        slug: SLUG[id] ?? norm(id).replace(/\s+/g, '-'),
        semTiles: !SLUG[id],
        eventos: eventosPorChave.get(chave(traduzido)) ?? eventosPorChave.get(chave(id)) ?? [],
      };
    });
    // mapas com marcadores e tiles que não vieram em `maps.json`
    for (const id of Object.keys(marcadores?.maps ?? {})) {
      if (arr.some((m) => m.id === id)) continue;
      arr.push({
        id,
        nome: ANDAR[id] ?? id.replace(/_/g, ' '),
        slug: SLUG[id] ?? norm(id).replace(/\s+/g, '-'),
        semTiles: !SLUG[id],
        eventos: eventosPorChave.get(chave(id)) ?? [],
      });
    }
    return arr;
  }, [lista, marcadores, eventosPorChave]);

  useEffect(() => {
    if (!ativo && mapas.length) {
      const comDados = mapas.find((m) => (marcadores?.maps?.[m.id]?.total ?? 0) > 0);
      setAtivo((comDados ?? mapas.find((m) => !m.semTiles) ?? mapas[0])!.id);
    }
  }, [mapas, ativo, marcadores]);

  /** Quantos marcadores de cada grupo existem no mapa atual. */
  const contagem = useMemo(() => {
    const m = ativo ? marcadores?.maps?.[ativo] : null;
    const c: Record<string, number> = {};
    for (const g of GRUPOS) c[g.id] = 0;
    if (!m) return c;
    for (const row of m.rows) {
      const nome = m.groups[row[2]];
      if (nome && c[nome] !== undefined) c[nome]++;
    }
    return c;
  }, [marcadores, ativo]);

  /** Subcategorias presentes, para a lista detalhada do painel. */
  const subs = useMemo(() => {
    const m = ativo ? marcadores?.maps?.[ativo] : null;
    if (!m) return [];
    const conta = new Map<string, number>();
    m.rows.forEach((r) => {
      const sub = m.subs[r[3]] ?? '';
      conta.set(sub, (conta.get(sub) ?? 0) + 1);
    });
    return [...conta].sort((a, b) => b[1] - a[1]);
  }, [marcadores, ativo]);

  if (erro) return <Vazio titulo="Mapas indisponíveis" dica="A release não trouxe maps.json." />;
  if (!lista) return <div class="muted">carregando mapas…</div>;
  if (!mapas.length) return <Vazio titulo="Nenhum mapa na base" dica="maps.json veio vazio." />;

  const mapa = mapas.find((m) => m.id === ativo) ?? mapas[0]!;
  /** `maps.json` traz `name` por idioma; `displayName` e o cru do servidor. */
  const rotuloMapa = (m: RawMap): string => txt(m.name) || (typeof m.displayName === 'string' ? m.displayName : '');
  const termo = busca.trim().toLowerCase();
  const gruposVisiveis = GRUPOS.filter((g) => !termo || rotuloGrupo(g).toLowerCase().includes(termo));
  const subsVisiveis = subs.filter(
    ([nome]) => !termo || rotuloSub(nome).toLowerCase().includes(termo),
  );
  const totalVisivel = Object.entries(camadas)
    .filter(([k, v]) => v)
    .reduce((n, [k]) => n + (contagem[k] ?? 0), 0);

  const todos = () => setCamadas(Object.fromEntries(GRUPOS.map((g) => [g.id, true])));
  const nenhum = () => setCamadas(Object.fromEntries(GRUPOS.map((g) => [g.id, false])));

  return (
    <div class="mapfill">
      <div class="page-head">
        <div>
          <div class="h2">Mapas</div>
          <div class="muted">
            {mapas.length} mapas ·{' '}
            {contando ? 'contando marcadores…' : `${totalVisivel.toLocaleString('pt-BR')} marcadores visíveis`}{' '}
            · arraste para mover, roda do mouse para zoom
          </div>
        </div>
      </div>

      <div class="mapsel">
        {mapas.map((m) => (
          <button
            key={m.id}
            type="button"
            class="chip-filter"
            aria-pressed={m.id === mapa.id}
            disabled={m.semTiles}
            title={m.semTiles ? 'sem tiles publicados para este mapa' : rotuloMapa(m)}
            onClick={() => {
              setAtivo(m.id);
              setContando(true);
              window.setTimeout(() => setContando(false), 400);
            }}
          >
            {rotuloMapa(m)}
            <span class="mapsel-n">
              {(marcadores?.maps?.[m.id]?.total ?? 0).toLocaleString('pt-BR')}
            </span>
            {m.eventos.some((e) => e.current) ? <span class="pip on" /> : null}
          </button>
        ))}
      </div>

      <div class="maplayout">
        <aside class="card mappanel">
          <input
            class="input"
            placeholder="filtrar camadas…"
            value={busca}
            onInput={(e) => setBusca((e.target as HTMLInputElement).value)}
          />

          <div class="mapsec">Camadas</div>
          {gruposVisiveis.map((g) => (
            <label key={g.id} class="maprow" data-on={camadas[g.id] ? '1' : '0'}>
              <svg class="maprow-ic" viewBox="-8 -8 16 16" aria-hidden="true">
                <path d={pathForma(g.forma, 6)} fill={g.cor} />
              </svg>
              <span class="maprow-t">{rotuloGrupo(g)}</span>
              <span class="maprow-n">{(contagem[g.id] ?? 0).toLocaleString('pt-BR')}</span>
              <input
                type="checkbox"
                checked={camadas[g.id] ?? false}
                onChange={(e) => {
                  const v = (e.target as HTMLInputElement).checked;
                  setCamadas({ ...camadas, [g.id]: v });
                  setContando(true);
                  window.setTimeout(() => setContando(false), 400);
                }}
              />
            </label>
          ))}

          <div class="mapsec">Detalhes</div>
          {subsVisiveis.length ? (
            <div class="mapsubs">
              {subsVisiveis.map(([nome, n]) => (
                <button
                  key={nome}
                  type="button"
                  class="mapsub"
                  onClick={() => setBusca(nome)}
                  title="filtrar por este tipo"
                >
                  <span class="mapsub-t">{rotuloSub(nome)}</span>
                  <span class="maprow-n">{n.toLocaleString('pt-BR')}</span>
                </button>
              ))}
            </div>
          ) : (
            <div class="muted" style={{ fontSize: 11 }}>
              sem marcadores neste mapa
            </div>
          )}

          {mapa.eventos.length ? (
            <>
              <div class="mapsec">Eventos neste mapa</div>
              {mapa.eventos.map((e) => (
                <div key={e.id} class="maprow">
                  <span class="maprow-t">{nomeEvento(e.id, e.name, idioma())}</span>
                  {e.current ? <span class="pill ok">ativo</span> : null}
                </div>
              ))}
            </>
          ) : null}

          <div class="mapsec">Mostrar</div>
          <div class="maprow">
            <button type="button" class="btn ghost" onClick={todos}>
              todas
            </button>
            <button type="button" class="btn ghost" onClick={nenhum}>
              nenhuma
            </button>
          </div>
        </aside>

        <Tela
          slug={mapa.slug}
          nome={rotuloMapa(mapa)}
          semTiles={mapa.semTiles}
          key={mapa.id}
          dados={marcadores?.maps?.[mapa.id]}
          camadas={camadas}
        />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- tela */

function Tela({
  slug,
  nome,
  semTiles,
  dados,
  camadas,
}: {
  slug: string;
  nome: string;
  semTiles: boolean;
  dados?: MapaColunar;
  camadas: Record<string, boolean>;
}) {
  const el = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const [falhou, setFalhou] = useState(false);

  /* tiles + marcadores: uma vez por mapa */
  useEffect(() => {
    if (!el.current || mapa.current || semTiles) return;

    const m = L.map(el.current, {
      crs: L.CRS.Simple,
      minZoom: 0,
      maxZoom: Z_MAX,
      zoomSnap: 0.25,
      wheelPxPerZoomLevel: 140,
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
    });

    const erros = { low: 0, high: 0 };
    const conta = (banda: 'low' | 'high') => () => {
      if (++erros[banda] > 6) setFalhou(true);
    };

    const low = L.tileLayer(`${CDN}/${slug}/v2/low/{z}/{x}/{y}.webp`, {
      minZoom: 0,
      maxZoom: Z_MAX,
      minNativeZoom: 0,
      maxNativeZoom: 1,
      tileSize: 512,
      attribution: 'tiles: ARC Tracker (hotlink)',
    });
    const high = L.tileLayer(`${CDN}/${slug}/v2/high/{z}/{x}/{y}.webp`, {
      minZoom: 0,
      maxZoom: Z_MAX,
      minNativeZoom: 2,
      maxNativeZoom: Z_MAX,
      tileSize: 512,
      keepBuffer: 2,
    });

    low.on('tileerror', conta('low'));
    high.on('tileerror', conta('high'));
    low.on('load', () => setFalhou(false));
    high.on('load', () => setFalhou(false));

    low.addTo(m);
    high.addTo(m);
    m.setView([0, 0], 0);

    low.setOpacity(1);
    high.setOpacity(0);
    m.on('zoomend', () => {
      const z = m.getZoom();
      low.setOpacity(z >= 2 ? 0 : 1);
      high.setOpacity(z >= 2 ? 1 : 0);
    });

    mapa.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);

    return () => {
      ro.disconnect();
      m.remove();
      mapa.current = null;
    };
  }, [slug, semTiles]);

  /* marcadores: um layer por grupo, para o filtro poder ligar e desligar */
  const layers = useRef<Record<string, L.LayerGroup>>({});

  useEffect(() => {
    const m = mapa.current;
    if (!m || !dados) return;

    for (const g of Object.values(layers.current)) m.removeLayer(g);
    layers.current = {};

    if (!dados.rows.length) return;

    // `circleMarker` no renderer canvas desenha milhares sem queda de quadro,
    // ao contrário de `L.marker` com divIcon (um nó DOM por ponto). O que
    // diferencia os grupos em tela é cor e peso — o desenho em SVG da legenda
    // carrega o resto da identidade.
    const renderer = L.canvas({ padding: 0.35 });

    for (const g of GRUPOS) {
      const grupo = L.layerGroup();
      const raio = g.id === 'arc' ? 5 : 4;

      for (const row of dados.rows) {
        if (dados.groups[row[2]] !== g.id) continue;
        const trancado = (row[4] & 1) !== 0;
        grupo.addLayer(
          L.circleMarker([row[0], row[1]], {
            renderer,
            radius: raio,
            color: g.cor,
            weight: 1,
            fillColor: g.cor,
            // trancado fica mais apagado: é informação real do marcador, e
            // saber de antemão evita gastar munição abrindo porta vazia
            fillOpacity: trancado ? 0.3 : 0.85,
          }),
        );
      }
      layers.current[g.id] = grupo;
    }

    for (const g of GRUPOS) {
      if (camadas[g.id]) m.addLayer(layers.current[g.id]!);
    }

    /**
     * Enquadra o mapa nos marcadores.
     *
     * O `setView([0, 0])` herança dos tiles não serve: em `CRS.Simple` a
     * origem é o canto do mundo, e as coordenadas do MetaForge vão de `lat`
     * 975 a 12.908. Centralizar em zero deixa praticamente todo marcador fora
     * da tela — o mapa aparece "vazio" com a camada ligada e o contador
     * mostrando oito mil. O enquadramento vem dos próprios dados, com uma
     * margem para o tiles não encostar na borda.
     */
    if (dados.rows.length) {
      let minLat = Infinity;
      let maxLat = -Infinity;
      let minLng = Infinity;
      let maxLng = -Infinity;
      for (const r of dados.rows) {
        if (r[0] < minLat) minLat = r[0];
        if (r[0] > maxLat) maxLat = r[0];
        if (r[1] < minLng) minLng = r[1];
        if (r[1] > maxLng) maxLng = r[1];
      }
      m.invalidateSize();
      m.fitBounds(
        L.latLngBounds(
          [minLat, minLng],
          [maxLat, maxLng],
        ),
        { padding: [24, 24], maxZoom: Z_MAX },
      );
    }
  }, [dados]);

  /* o filtro: liga e desliga os layers sem redesenhar o mapa */
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    for (const g of GRUPOS) {
      const l = layers.current[g.id];
      if (!l) continue;
      if (camadas[g.id] && !m.hasLayer(l)) m.addLayer(l);
      if (!camadas[g.id] && m.hasLayer(l)) m.removeLayer(l);
    }
  }, [camadas]);

  if (semTiles) {
    return (
      <div class="mapwrap mapwrap-vazio">
        <div class="empty">
          <div class="empty-title">Sem tiles publicados</div>
          <div class="empty-hint">
            A CDN não serve tiles para este mapa. Os marcadores e as camadas continuam disponíveis
            ao lado.
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div class="mapwrap" ref={el} aria-label={`mapa ${nome}`} />
      {falhou ? (
        <div class="muted" style={{ marginTop: 6, fontSize: 11 }}>
          Os tiles deste mapa pararam de responder. Endereço base:
          <span class="mono"> {CDN}/{slug}/v2/…</span>
        </div>
      ) : null}
    </>
  );
}
