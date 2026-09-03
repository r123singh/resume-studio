/**
 * Test environment.
 *
 * Loaded with `node --test --import ./test/setup.mjs` so these are set before
 * any module reads them. `NODE_ENV=test` is what makes the data layer resolve
 * to the in-memory store instead of DynamoDB.
 */
process.env.NODE_ENV = 'test'
process.env.ENVIRONMENT = 'dev'
process.env.TABLE_NAME = 'resume-studio-test-platform'
process.env.JWT_SECRET = 'test-jwt-secret-value-not-used-anywhere-real'
process.env.BILLING_WEBHOOK_SECRET = 'test-billing-webhook-secret'
process.env.BILLING_PROVIDER = 'manual'
