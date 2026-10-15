/**
 * Arc GX — backend de dados do jogo.
 *
 * Cloudflare Worker + D1, free tier. Guarda so o que o usuario corrige:
 * o dado bruto do jogo (que e grande e de terceiros) continua vindo das
 * fontes publicas via data-release; aqui so mora o ajuste fino.
 *
 * O resultado e um "patch" pequeno que o app aplica sobre a semente. Assim:
 *   - o repo continua leve e barato de servir
 *   - a base converge pro build atual sem esperar ninguem publicar
 *   - quem decide o dado e quem usa, e nao quem extraiu
 *
 * Rotas:
 *   GET  /v1/health
 *   GET  /v1/patch?since=<iso>          -> correcoes consolidadas
 *   GET  /v1/items/:id                  -> estado de um item
 *   POST /v1/items/:id                  -> corrige campo do item
 *   GET  /v1/signals/:id                -> o que a comunidade esta vendo como "desconhecido"
 *   POST /v1/entitlement/redeem          -> ativa premium por codigo
 *   GET  /v1/entitlement?install=        -> estado da assinatura
 *   POST /v1/admin/codes                -> cria codigos (protegido por token)
 *   GET  /v1/admin/queue                -> fila de moderacao
 *   POST /v1/admin/queue/:id            -> aprova/rejeita
 */

export interface Env {
  DB: D1Database;
  /** Token para /v1/admin/*. */
  ADMIN_TOKEN: string;
}

interface Correction {
  itemId: string;
  field: string;
  value: string;
  locale: string;
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, x-arcgx-install, x-arcgx-token',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'cache-control': 'public, max-age=60',
      ...headers,
    },
  });

const err = (message: string, status = 400): Response => json({ error: message }, status);

const now = (): string => new Date().toISOString();

/* ------------------------------------------------------------------ CORS */

function corsPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, x-arcgx-install, x-arcgx-token',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-max-age': '86400',
    },
  });
}

/* ------------------------------------------------------------ rate limit */

const MIN_SECONDS_BETWEEN_SUBMITS = 20;
const MAX_DAILY_SUBMITS = 200;

async function checkRateLimit(env: Env, installId: string): Promise<{ ok: boolean; reason?: string }> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM report
      WHERE author = ?1 AND created_at > datetime('now', '-1 day')`,
  )
    .bind(installId)
    .first<{ n: number }>();

  if ((row?.n ?? 0) >= MAX_DAILY_SUBMITS) {
    return { ok: false, reason: `limite diario de ${MAX_DAILY_SUBMITS} correcoes atingido` };
  }

  const last = await env.DB.prepare(
    `SELECT created_at FROM report WHERE author = ?1 ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(installId)
    .first<{ created_at: string }>();

  if (last?.created_at) {
    const elapsed = (Date.now() - Date.parse(last.created_at)) / 1000;
    if (elapsed < MIN_SECONDS_BETWEEN_SUBMITS) {
      return {
        ok: false,
        reason: `aguarde ${Math.ceil(MIN_SECONDS_BETWEEN_SUBMITS - elapsed)}s entre correcoes`,
      };
    }
  }

  return { ok: true };
}

/* ------------------------------------------------------- correcoes (API) */

/**
 * Uma correcao entra em duas etapas:
 *  1. `signal` — o usuario contou que aquele item existe com aquele valor
 *  2. `correction` — consolida por consenso (mesmo valor de N instalacoes
 *     diferentes entra como peso alto)
 *
 * Sem o passo 2, um unico usuari Introducing um valor errado contamina a base.
 */
async function submitCorrection(
  env: Env,
  installId: string,
  itemId: string,
  body: { field?: string; value?: string; locale?: string; note?: string },
): Promise<Response> {
  const field = String(body.field ?? '').trim();
  const value = String(body.value ?? '').trim();
  const locale = String(body.locale ?? 'en').slice(0, 8);

  const allowed = ['name', 'value', 'tier', 'type', 'description'];
  if (!allowed.includes(field)) return err(`campo invalido: ${field}`);
  if (!value || value.length > 200) return err('valor invalido ou longo demais');
  if (!/^[a-z0-9_.-]{2,80}$/i.test(itemId)) return err('item_id invalido');

  const rate = await checkRateLimit(env, installId);
  if (!rate.ok) return err(rate.reason!, 429);

  const ts = now();

  // 1. sinal
  await env.DB.prepare(
    `INSERT INTO item_signal (item_id, field, locale, value, first_seen)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(item_id, field, locale) DO NOTHING`,
  )
    .bind(itemId, field, locale, value, ts)
    .run();

  // 2. fila de moderacao
  const reportId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO report (id, item_id, field, author, payload, status, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6)`,
  )
    .bind(reportId, itemId, field, installId, JSON.stringify({ value, locale, note: body.note ?? null }), ts)
    .run();

  // consenso: 3 instalacoes independentes com o mesmo valor aprovam sozinhas.
  // Conta QUALQUER report com o mesmo valor (pending inclusive) — senao os
  // dois primeiros nunca sao aprovados e o consenso nunca chega a 3.
  const agree = await env.DB.prepare(
    `SELECT COUNT(DISTINCT author) AS n FROM report
      WHERE item_id = ?1 AND field = ?2
        AND json_extract(payload,'$.locale') = ?3
        AND json_extract(payload,'$.value') = ?4`,
  )
    .bind(itemId, field, locale, value)
    .first<{ n: number }>();

  const autoApproved = (agree?.n ?? 0) >= 3;
  if (autoApproved) {
    await applyCorrection(env, itemId, field, value, locale, installId);
    // fecha todos os reports que concordavam, nao so o ultimo
    await env.DB.prepare(
      `UPDATE report SET status = 'approved', resolved_at = ?2
        WHERE item_id = ?1 AND field = ?3 AND status = 'pending'
          AND json_extract(payload,'$.locale') = ?4
          AND json_extract(payload,'$.value') = ?5`,
    )
      .bind(itemId, ts, field, locale, value)
      .run();
  }

  return json(
    {
      ok: true,
      reportId,
      status: autoApproved ? 'approved' : 'pending',
      message: autoApproved
        ? 'consenso alcancado, ja aplicado'
        : `enviado para revisao; ${3 - (agree?.n ?? 0)} confirmacao(oes) independente(s) faltam`,
    },
    202,
  );
}

async function applyCorrection(
  env: Env,
  itemId: string,
  field: string,
  value: string,
  locale: string,
  author: string,
): Promise<void> {
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO correction (item_id, field, value, locale, author, weight, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)
     ON CONFLICT(item_id, field, locale) DO UPDATE SET
       value      = excluded.value,
       author     = excluded.author,
       weight     = correction.weight + 1,
       updated_at = excluded.updated_at`,
  )
    .bind(itemId, field, value, locale, author, ts)
    .run();
}

/** Patch: tudo que mudou depois de `since`. Vazio = snapshot completo. */
async function buildPatch(env: Env, since?: string): Promise<Response> {
  const query = since
    ? env.DB.prepare(
        `SELECT item_id, field, value, locale, weight, updated_at
           FROM correction WHERE updated_at > ?1 ORDER BY updated_at LIMIT 5000`,
      ).bind(since)
    : env.DB.prepare(
        `SELECT item_id, field, value, locale, weight, updated_at
           FROM correction ORDER BY updated_at LIMIT 5000`,
      );

  const { results } = await query.all<{
    item_id: string;
    field: string;
    value: string;
    locale: string;
    weight: number;
    updated_at: string;
  }>();

  const byItem: Record<string, Record<string, Record<string, { value: string; weight: number }>>> = {};
  for (const r of results ?? []) {
    const fields = (byItem[r.item_id] ??= {});
    const locales = (fields[r.field] ??= {});
    locales[r.locale] = { value: r.value, weight: r.weight };
  }

  const latest = (results ?? []).at(-1)?.updated_at ?? null;
  return json({ version: latest, count: (results ?? []).length, items: byItem });
}

/* ------------------------------------------------------------ entitlement */

async function redeem(env: Env, installId: string, code: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT code, tier, max_uses, uses, expires_at, disabled
       FROM entitlement WHERE code = ?1`,
  )
    .bind(code.toUpperCase())
    .first<{ code: string; tier: string; max_uses: number; uses: number; expires_at: string | null; disabled: number }>();

  if (!row) return err('codigo invalido', 404);
  if (row.disabled) return err('codigo desativado', 403);
  if (row.uses >= row.max_uses) return err('codigo ja utilizado', 403);
  if (row.expires_at && Date.parse(row.expires_at) < Date.now()) return err('codigo expirado', 403);

  const ts = now();
  const existing = await env.DB.prepare(`SELECT expires_at FROM subscription WHERE install_id = ?1`)
    .bind(installId)
    .first<{ expires_at: string | null }>();

  // reativar nao empurra a data que ja estava correndo
  const expiresAt = existing?.expires_at ?? null;

  await env.DB.prepare(
    `INSERT INTO subscription (install_id, tier, code, started_at, expires_at)
     VALUES (?1, 'premium', ?2, ?3, ?4)
     ON CONFLICT(install_id) DO UPDATE SET tier = 'premium', code = excluded.code`,
  )
    .bind(installId, row.code, ts, expiresAt)
    .run();

  await env.DB.prepare(`UPDATE entitlement SET uses = uses + 1 WHERE code = ?1`).bind(row.code).run();

  return json({ ok: true, tier: 'premium', expiresAt, code: row.code });
}

async function entitlementStatus(env: Env, installId: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT tier, expires_at FROM subscription WHERE install_id = ?1`,
  )
    .bind(installId)
    .first<{ tier: string; expires_at: string | null }>();

  if (!row) return json({ tier: 'free', expiresAt: null });

  if (row.expires_at && Date.parse(row.expires_at) < Date.now()) {
    return json({ tier: 'free', expiresAt: null, expiredFrom: row.expires_at });
  }
  return json({ tier: row.tier, expiresAt: row.expires_at });
}

/* ------------------------------------------------------------------ admin */

function isAdmin(req: Request, env: Env): boolean {
  const token = req.headers.get('x-arcgx-token');
  return Boolean(token) && token === env.ADMIN_TOKEN;
}

async function createCode(
  env: Env,
  req: Request,
): Promise<Response> {
  if (!isAdmin(req, env)) return err('nao autorizado', 401);

  let body: { count?: number; note?: string; maxUses?: number; expiresAt?: string; days?: number };
  try {
    body = await req.json();
  } catch {
    return err('corpo invalido');
  }

  const count = Math.min(Math.max(Number(body.count ?? 1), 1), 200);
  const maxUses = Math.min(Math.max(Number(body.maxUses ?? 1), 1), 1000);
  const days = body.days ? Math.min(Math.max(Number(body.days), 1), 3650) : null;
  const expiresAt = body.expiresAt ?? (days ? new Date(Date.now() + days * 864e5).toISOString() : null);

  // codigo legivel: GX-XXXX-XXXX-XXXX
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const codes: string[] = [];

  for (let i = 0; i < count; i++) {
    let body2 = '';
    for (let g = 0; g < 3; g++) {
      let chunk = '';
      for (let c = 0; c < 4; c++) chunk += alphabet[Math.floor(Math.random() * alphabet.length)];
      body2 += (g ? '-' : '') + chunk;
    }
    const code = 'GX-' + body2;
    codes.push(code);
    await env.DB.prepare(
      `INSERT INTO entitlement (code, tier, note, max_uses, uses, expires_at, created_at)
       VALUES (?1, 'premium', ?2, ?3, 0, ?4, ?5)`,
    )
      .bind(code, body.note ?? null, maxUses, expiresAt, now())
      .run();
  }

  return json({ ok: true, count, codes }, 201);
}

async function queue(req: Request, env: Env): Promise<Response> {
  if (!isAdmin(req, env)) return err('nao autorizado', 401);

  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? 'pending';
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);

  const { results } = await env.DB.prepare(
    `SELECT id, item_id, field, author, payload, created_at
       FROM report WHERE status = ?1 ORDER BY created_at ASC LIMIT ?2`,
  )
    .bind(status, limit)
    .all();

  return json({ reports: results ?? [] });
}

async function resolve(
  env: Env,
  req: Request,
  reportId: string,
  decision: 'approve' | 'reject',
): Promise<Response> {
  if (!isAdmin(req, env)) return err('nao autorizado', 401);

  const row = await env.DB.prepare(
    `SELECT item_id, field, author, payload FROM report WHERE id = ?1 AND status = 'pending'`,
  )
    .bind(reportId)
    .first<{ item_id: string; field: string; author: string; payload: string }>();

  if (!row) return err('report nao encontrado ou ja resolvido', 404);

  const ts = now();
  const payload = JSON.parse(row.payload) as { value: string; locale: string };

  if (decision === 'approve') {
    await applyCorrection(env, row.item_id, row.field, payload.value, payload.locale ?? 'en', row.author);
  }
  await env.DB.prepare(`UPDATE report SET status = ?2, resolved_at = ?3 WHERE id = ?1`)
    .bind(reportId, decision === 'approve' ? 'approved' : 'rejected', ts)
    .run();

  return json({ ok: true, id: reportId, status: decision === 'approve' ? 'approved' : 'rejected' });
}

/* ------------------------------------------------------------------ router */

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return corsPreflight();

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const installId = req.headers.get('x-arcgx-install') ?? 'anonymous';

    try {
      if (path === '/' || path === '/v1/health') {
        const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM correction`).first<{ n: number }>();
        return json({
          ok: true,
          service: 'arcgx-data',
          corrections: row?.n ?? 0,
          time: now(),
        });
      }

      if (path === '/v1/patch' && req.method === 'GET') {
        return await buildPatch(env, url.searchParams.get('since') ?? undefined);
      }

      if (path === '/v1/signals' && req.method === 'GET') {
        const { results } = await env.DB.prepare(
          `SELECT item_id, field, locale, value, COUNT(*) AS seen
             FROM item_signal
            WHERE first_seen > ?1
            GROUP BY item_id, field, locale, value
           HAVING seen >= 2
            ORDER BY first_seen DESC LIMIT 100`,
        )
          .bind(new Date(Date.now() - 7 * 864e5).toISOString())
          .all();
        return json({ signals: results ?? [] });
      }

      const itemMatch = path.match(/^\/v1\/items\/([a-zA-Z0-9_.-]+)$/);
      if (itemMatch) {
        const itemId = itemMatch[1]!;

        if (req.method === 'GET') {
          const { results } = await env.DB.prepare(
            `SELECT field, value, locale, weight, updated_at
               FROM correction WHERE item_id = ?1`,
          )
            .bind(itemId)
            .all();
          return json({ itemId, corrections: results ?? [] });
        }

        if (req.method === 'POST') {
          const body = (await req.json().catch(() => ({}))) as {
            field?: string;
            value?: string;
            locale?: string;
            note?: string;
          };
          return await submitCorrection(env, installId, itemId, body);
        }
      }

      if (path === '/v1/entitlement/redeem' && req.method === 'POST') {
        const body = (await req.json().catch(() => ({}))) as { code?: string };
        if (!body.code) return err('codigo ausente');
        return await redeem(env, installId, body.code);
      }

      if (path === '/v1/entitlement' && req.method === 'GET') {
        return await entitlementStatus(env, url.searchParams.get('install') ?? installId);
      }

      /* admin */
      if (path === '/v1/admin/codes' && req.method === 'POST') return await createCode(env, req);
      if (path === '/v1/admin/queue' && req.method === 'GET') return await queue(req, env);

      const queueMatch = path.match(/^\/v1\/admin\/queue\/([a-zA-Z0-9-]+)\/(approve|reject)$/);
      if (queueMatch && req.method === 'POST') {
        return await resolve(env, req, queueMatch[1]!, queueMatch[2] as 'approve' | 'reject');
      }

      return err('rota nao encontrada', 404);
    } catch (e) {
      return json({ error: 'erro interno', detail: e instanceof Error ? e.message : String(e) }, 500);
    }
  },
};