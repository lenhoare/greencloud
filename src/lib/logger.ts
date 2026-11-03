/**
 * Structured JSON logger. Workers Logs (enabled via `observability` in
 * wrangler.jsonc) indexes JSON fields, so you can filter by requestId, userId…
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export function createLogger(base: LogFields = {}): Logger {
  const write = (level: LogLevel, msg: string, fields?: LogFields) => {
    const line = JSON.stringify({ level, msg, ...base, ...fields, ...errorFields(fields) });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };
  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (fields) => createLogger({ ...base, ...fields }),
  };
}

/** Error objects don't JSON.stringify usefully; expand them. */
function errorFields(fields?: LogFields): LogFields | undefined {
  const err = fields?.err;
  if (!(err instanceof Error)) return undefined;
  return { err: { name: err.name, message: err.message, stack: err.stack } };
}
