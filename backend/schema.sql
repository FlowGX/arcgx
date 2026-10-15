-- Arc GX — schema do backend (Cloudflare D1)
--
-- Free tier do Cloudflare: 5M leituras/dia, 100k escritas/dia.
-- Guardamos o minimo necessario: o dado bruto do jogo NAO fica aqui,
-- so as correcoes dos usuarios sobre ele.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- correcoes
-- Uma linha por (item, campo). Uma correcao nova substitui a anterior em vez
-- de acumular: o manifesto e um snapshot, nao um historico.
CREATE TABLE IF NOT EXISTS correction (
  item_id    TEXT NOT NULL,
  field      TEXT NOT NULL CHECK (field IN ('name','value','tier','type','description')),
  value      TEXT NOT NULL,
  locale     TEXT NOT NULL DEFAULT 'en',
  -- quem enviou
  author     TEXT NOT NULL,
  -- confianca acumulada: cada confirmacao independente soma 1
  weight     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (item_id, field, locale)
);

CREATE INDEX IF NOT EXISTS correction_updated ON correction(updated_at DESC);
CREATE INDEX IF NOT EXISTS correction_author ON correction(author);

-- ------------------------------------------------------------------ instalacoes
CREATE TABLE IF NOT EXISTS install (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  last_seen   TEXT NOT NULL,
  build       TEXT,
  app_version TEXT
);

-- --------------------------------------------------------- rate limit e spam
-- Um item novo so entra no consolidado com confirmacoes independentes.
CREATE TABLE IF NOT EXISTS item_signal (
  item_id    TEXT NOT NULL,
  field      TEXT NOT NULL,
  locale     TEXT NOT NULL DEFAULT 'en',
  value      TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  PRIMARY KEY (item_id, field, locale)
);

-- ------------------------------------------------------------- entitlement
-- Premium por codigo. O dono cria os codos; nao ha cobranca automatica aqui.
CREATE TABLE IF NOT EXISTS entitlement (
  code        TEXT PRIMARY KEY,
  tier        TEXT NOT NULL CHECK (tier IN ('premium')),
  note        TEXT,
  max_uses    INTEGER NOT NULL DEFAULT 1,
  uses        INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT,
  created_at  TEXT NOT NULL,
  disabled    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS subscription (
  install_id  TEXT PRIMARY KEY,
  tier        TEXT NOT NULL CHECK (tier IN ('free','premium')),
  code        TEXT,
  started_at  TEXT NOT NULL,
  expires_at  TEXT
);

-- ------------------------------------------------------------- moderacao
CREATE TABLE IF NOT EXISTS report (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL,
  field       TEXT NOT NULL,
  author      TEXT NOT NULL,
  payload     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at  TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS report_status ON report(status, created_at DESC);
CREATE INDEX IF NOT EXISTS report_item ON report(item_id, status);