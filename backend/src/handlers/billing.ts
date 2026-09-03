import { ok, type HttpRequest, type HttpResponse } from '../lib/http.js'
import { applyBillingEvent, billingProvider, webhookSecret } from '../domain/billing.js'

/**
 * Billing provider webhook.
 *
 * Unauthenticated by design — the signature is the credential. A 200 is
 * returned for duplicate and unmatched events so the provider stops retrying
 * something that will never succeed; only genuine failures surface as errors.
 */
export async function webhook(req: HttpRequest): Promise<HttpResponse> {
  const provider = billingProvider()
  const secret = await webhookSecret()

  provider.verifyWebhook(req.rawBody, req.headers, secret)
  const event = provider.parseEvent(req.rawBody)

  const log = req.log.child({ provider: provider.name, eventId: event.eventId })
  const result = await applyBillingEvent(event, log)

  return ok({ received: true, applied: result.applied })
}
