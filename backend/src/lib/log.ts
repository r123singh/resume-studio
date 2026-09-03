/**
 * Structured logging with an allow-list mindset.
 *
 * Resume content is the user's most sensitive data in this product, and tokens
 * and secrets are the most dangerous, so values are redacted by key name and
 * long strings are reduced to a length. Anything that needs to be searchable
 * must be passed as an explicit scalar field.
 */
const REDACT_KEYS = new Set([
  'password',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'secret',
  'jwtsecret',
  'apikey',
  'signature',
  'content',
  'messages',
  'system',
  'text',
  'prompt',
  'resume',
  'card',
  'cardnumber',
])

const MAX_STRING = 200

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `[string len=${value.length}]` : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value.length > 20 ? `[array len=${value.length}]` : value.map((v) => redact(v, depth + 1))
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACT_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(val, depth + 1)
    }
    return out
  }
  return '[unloggable]'
}

export type LogFields = Record<string, unknown>

export class Logger {
  constructor(private readonly base: LogFields = {}) {}

  child(fields: LogFields): Logger {
    return new Logger({ ...this.base, ...fields })
  }

  private emit(level: 'debug' | 'info' | 'warn' | 'error', message: string, fields?: LogFields) {
    const line = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(redact(this.base) as LogFields),
      ...(fields ? (redact(fields) as LogFields) : {}),
    }
    const serialized = JSON.stringify(line)
    if (level === 'error') console.error(serialized)
    else if (level === 'warn') console.warn(serialized)
    else console.log(serialized)
  }

  debug = (message: string, fields?: LogFields) => this.emit('debug', message, fields)
  info = (message: string, fields?: LogFields) => this.emit('info', message, fields)
  warn = (message: string, fields?: LogFields) => this.emit('warn', message, fields)
  error = (message: string, fields?: LogFields) => this.emit('error', message, fields)

  /**
   * Emits an embedded-metric-format line so CloudWatch derives metrics without
   * a separate metrics client or a PutMetricData call per request.
   */
  metric(name: string, value: number, unit = 'Count', dimensions: Record<string, string> = {}) {
    console.log(
      JSON.stringify({
        _aws: {
          Timestamp: Date.now(),
          CloudWatchMetrics: [
            {
              Namespace: 'ResumeStudio/AI',
              Dimensions: [Object.keys(dimensions)],
              Metrics: [{ Name: name, Unit: unit }],
            },
          ],
        },
        ...dimensions,
        [name]: value,
      }),
    )
  }
}

export const logger = new Logger()
