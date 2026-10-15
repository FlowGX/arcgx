import { useEffect, useState } from 'preact/hooks';

import type { UpdateCheck } from '@arcgx/shared';

/**
 * Texto curto da checagem.
 *
 * Fica aqui em vez de importar do pacote porque o barrel de `@arcgx/shared`
 * puxa módulos de Node (`logger` usa `mkdirSync`) e o vite não externaliza
 * isso no bundle do browser. Seis linhas de texto não justificam arrastar o
 * barrel inteiro para dentro da view.
 */
function descrever(c: UpdateCheck): string {
  if (!c.hasUpdate) return 'Nenhuma novidade no catálogo do jogo.';
  const partes: string[] = [];
  if (c.added.length) partes.push(`${c.added.length}+ item(ns) novo(s)`);
  if (c.removed.length) partes.push(`${c.removed.length} removido(s)`);
  if (c.changed.length) partes.push(`${c.changed.length} com campos alterados`);
  return `${partes.join(', ')}. A base local tem ${c.totals.local}; a fonte reporta ${c.totals.remoto}.`;
}

const api = window.arcgx.desktop;

/**
 * Aviso de novidade no catálogo do jogo.
 *
 * **Não atualiza sozinho.** A diferença contra a fonte aparece aqui, com o
 * que mudou e a descrição, e o usuário decide. Atualizar sem perguntar
 * trocaria uma galeria de ícone consistente por uma metade preenchida sem
 * revisão, e o classificador erraria mais do que já erra.
 */
export function GameUpdateNotice() {
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [resposta, setResposta] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api
      .gameUpdateCheck()
      .then((c) => alive && setCheck(c))
      .catch(() => alive && setCheck(null));
    return () => {
      alive = false;
    };
  }, []);

  // o main reemite o status quando a checagem de fundo termina
  useEffect(() => {
    const off = api.onStatusChanged(() => {
      void api
        .gameUpdateCheck()
        .then((c) => alive2(c))
        .catch(() => {});
    });
    return off;
    function alive2(c: UpdateCheck | null) {
      setCheck(c);
    }
  }, []);

  async function verAgora() {
    setOcupado(true);
    try {
      const c = await api.gameUpdateCheck();
      setCheck(c);
      setAberto(true);
    } finally {
      setOcupado(false);
    }
  }

  async function dispensar() {
    const chave = check ? `${check.totals.local}:${check.totals.remoto}:${check.checkedAt}` : '';
    await api.gameUpdateResolve(chave).catch(() => {});
    setResposta('dispensado');
    setAberto(false);
  }

  if (resposta) return null;
  if (!check?.hasUpdate) return null;

  return (
    <div class="notice-update">
      <div class="notice-update-head">
        <span class="dot" />
        <strong>Há novidade no catálogo do jogo</strong>
        <div style={{ flex: 1 }} />
        <button type="button" class="btn ghost" onClick={() => setAberto((a) => !a)}>
          {aberto ? 'esconder' : 'ver o que mudou'}
        </button>
      </div>

      <div class="muted" style={{ fontSize: 11.5, marginTop: 4, lineHeight: 1.55 }}>
        {descrever(check)}
      </div>

      {aberto ? (
        <div class="notice-update-body">
          {check.added.length ? (
            <div>
              <div class="nu-t">Novos ({check.added.length}+)</div>
              <div class="chips" style={{ marginTop: 6 }}>
                {check.added.slice(0, 24).map((id) => (
                  <span key={id} class="chip">
                    {id.replace(/[-_]/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {check.changed.length ? (
            <div style={{ marginTop: 14 }}>
              <div class="nu-t">Alterados ({check.changed.length})</div>
              <div class="chips" style={{ marginTop: 6 }}>
                {check.changed.slice(0, 24).map((c) => (
                  <span key={c.id} class="chip" title={c.campos.join(', ')}>
                    {c.nome}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {check.removed.length ? (
            <div style={{ marginTop: 14 }}>
              <div class="nu-t">Saíram do catálogo ({check.removed.length})</div>
              <div class="chips" style={{ marginTop: 6 }}>
                {check.removed.slice(0, 16).map((id) => (
                  <span key={id} class="chip">
                    {id.replace(/[-_]/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button type="button" class="btn primary" onClick={() => void api.syncData().then(verAgora)}>
              Buscar as novidades
            </button>
            <button type="button" class="btn" onClick={() => void dispensar()}>
              Agora não
            </button>
            <button type="button" class="btn ghost" onClick={() => void verAgora()} disabled={ocupado}>
              {ocupado ? 'conferindo…' : 'só conferir de novo'}
            </button>
          </div>

          <div class="muted" style={{ fontSize: 10.5, marginTop: 10, lineHeight: 1.5 }}>
            O app nunca troca o catálogo sozinho. Conteúdo novo costuma chegar sem metade dos
            ícones, e uma galeria pela metade faz o reconhecedor errar mais do que uma galeria
            antiga e completa.
          </div>
        </div>
      ) : null}
    </div>
  );
}
