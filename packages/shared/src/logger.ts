import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let minLevel: LogLevel = process.env.ARC_LOG_LEVEL === 'debug' ? 'debug' : 'info';
let stream: WriteStream | null = null;

function openStream(): WriteStream | null {
  if (stream) return stream;
  try {
    const dir = process.env.ARC_LOG_DIR ?? process.env.ARC_LOG_FILE ?? '';
    const file = process.env.ARC_LOG_FILE ?? (dir ? path.join(dir, 'arcgx.log') : '');
    if (!file) return null;
    mkdirSync(path.dirname(file), { recursive: true });
    stream = createWriteStream(file, { flags: 'a' });
    stream.on('error', () => {
      stream = null;
    });
    return stream;
  } catch {
    return null;
  }
}

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

function emit(level: LogLevel, scope: string, args: unknown[]): void {
  if (LEVELS[level] < LEVELS[minLevel]) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${args
    .map((a) => (typeof a === 'string' ? a : safeStringify(a)))
    .join(' ')}`;
  const s = openStream();
  if (s) s.write(line + '\n');
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, replacer);
  } catch {
    return String(value);
  }
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  return value;
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  child(sub: string): Logger;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (...a) => emit('debug', scope, a),
    info: (...a) => emit('info', scope, a),
    warn: (...a) => emit('warn', scope, a),
    error: (...a) => emit('error', scope, a),
    child: (sub) => createLogger(`${scope}:${sub}`),
  };
}

export const logger = createLogger('gx');