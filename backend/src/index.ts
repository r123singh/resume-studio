/**
 * Lambda entry point for the Function URL.
 *
 * Response streaming is why this is a Function URL rather than API Gateway:
 * `/ai/stream` must forward model tokens as they arrive to preserve the
 * desktop's existing streaming experience. Everything else is buffered.
 */
import { randomUUID } from 'node:crypto'
import { logger } from './lib/log.js'
import type { HttpRequest, HttpResponse } from './lib/http.js'
import { errorResponse, handleRequest, isStreamRoute } from './router.js'
import { aiStream } from './handlers/ai.js'

type FunctionUrlEvent = {
  rawPath?: string
  rawQueryString?: string
  headers?: Record<string, string | undefined>
  queryStringParameters?: Record<string, string | undefined>
  requestContext?: {
    requestId?: string
    http?: { method?: string; path?: string; sourceIp?: string }
  }
  body?: string
  isBase64Encoded?: boolean
}

type ResponseStream = {
  write(chunk: string): void
  end(): void
}

declare const awslambda: {
  streamifyResponse(
    handler: (event: FunctionUrlEvent, responseStream: ResponseStream) => Promise<void>,
  ): unknown
  HttpResponseStream: {
    from(
      stream: ResponseStream,
      metadata: { statusCode: number; headers?: Record<string, string> },
    ): ResponseStream
  }
}

function toHttpRequest(event: FunctionUrlEvent): HttpRequest {
  const requestId = event.requestContext?.requestId || randomUUID()
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers[key.toLowerCase()] = value
  }
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(event.queryStringParameters ?? {})) {
    if (value !== undefined) query[key] = value
  }

  const rawBody = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body
    : ''

  const method = event.requestContext?.http?.method || 'GET'
  const path = event.rawPath || event.requestContext?.http?.path || '/'
  const sourceIp = event.requestContext?.http?.sourceIp || 'unknown'

  return {
    method,
    path,
    headers,
    query,
    rawBody,
    requestId,
    sourceIp,
    log: logger.child({ requestId, method, path }),
  }
}

const SECURITY_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'strict-transport-security': 'max-age=63072000',
}

export const handler = awslambda.streamifyResponse(
  async (event: FunctionUrlEvent, responseStream: ResponseStream): Promise<void> => {
    const req = toHttpRequest(event)
    const startedAt = Date.now()

    if (isStreamRoute(req)) {
      // Headers must be committed before the first token, so the stream opens
      // optimistically and reports later failures as in-band events.
      const stream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 200,
        headers: {
          ...SECURITY_HEADERS,
          'content-type': 'text/event-stream',
          'x-request-id': req.requestId,
        },
      })

      try {
        await aiStream(req, (payload) => {
          stream.write(`data: ${JSON.stringify(payload)}\n\n`)
        })
      } catch (err) {
        const response = errorResponse(err, req)
        const body = response.body as { error?: { code?: string; message?: string } }
        stream.write(
          `data: ${JSON.stringify({
            type: 'platformError',
            code: body?.error?.code ?? 'INTERNAL_ERROR',
            message: body?.error?.message ?? 'Something went wrong.',
          })}\n\n`,
        )
      } finally {
        stream.write('data: [DONE]\n\n')
        stream.end()
        req.log.info('request.completed', { latencyMs: Date.now() - startedAt, streamed: true })
      }
      return
    }

    const response: HttpResponse = await handleRequest(req)
    const stream = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: response.status,
      headers: { ...SECURITY_HEADERS, ...(response.headers ?? {}) },
    })
    stream.write(JSON.stringify(response.body ?? {}))
    stream.end()
    req.log.info('request.completed', {
      status: response.status,
      latencyMs: Date.now() - startedAt,
    })
  },
)
