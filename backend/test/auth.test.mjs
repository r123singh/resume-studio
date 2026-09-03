import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { call, errorCode, resetPlatform, signUp } from './helpers.mjs'

describe('authentication', () => {
  beforeEach(resetPlatform)

  it('creates an account with a free subscription and returns tokens', async () => {
    const session = await signUp('new@example.com')
    assert.ok(session.access_token)
    assert.ok(session.refresh_token)
    assert.equal(session.account.email, 'new@example.com')

    const account = await call('GET', '/account', { token: session.access_token })
    assert.equal(account.status, 200)
    assert.equal(account.body.subscription.plan_id, 'free')
    assert.equal(account.body.entitlements.aiAccess, true)
  })

  it('rejects duplicate email registrations', async () => {
    await signUp('dupe@example.com')
    const second = await call('POST', '/auth/signup', {
      body: { email: 'dupe@example.com', password: 'another good password' },
    })
    assert.equal(second.status, 409)
    assert.equal(errorCode(second), 'CONFLICT')
  })

  it('enforces a password length floor', async () => {
    const response = await call('POST', '/auth/signup', {
      body: { email: 'short@example.com', password: 'short' },
    })
    assert.equal(errorCode(response), 'INVALID_REQUEST')
  })

  it('rejects a wrong password without revealing whether the account exists', async () => {
    await signUp('real@example.com', 'the correct password')

    const wrongPassword = await call('POST', '/auth/login', {
      body: { email: 'real@example.com', password: 'the wrong password' },
    })
    const noSuchUser = await call('POST', '/auth/login', {
      body: { email: 'ghost@example.com', password: 'the correct password' },
    })

    assert.equal(wrongPassword.status, 401)
    assert.equal(noSuchUser.status, 401)
    assert.equal(wrongPassword.body.error.message, noSuchUser.body.error.message)
  })

  it('rejects requests with no token or a forged token', async () => {
    const anonymous = await call('GET', '/account')
    assert.equal(errorCode(anonymous), 'AUTHENTICATION_REQUIRED')

    const forged = await call('GET', '/account', { token: 'a.b.c' })
    assert.equal(errorCode(forged), 'AUTHENTICATION_REQUIRED')
  })

  it('rotates the refresh token and issues a new access token', async () => {
    const session = await signUp()
    const refreshed = await call('POST', '/auth/refresh', {
      body: {
        user_id: session.account.user_id,
        session_id: session.session_id,
        refresh_token: session.refresh_token,
      },
    })

    assert.equal(refreshed.status, 200)
    assert.notEqual(refreshed.body.refresh_token, session.refresh_token)

    const account = await call('GET', '/account', { token: refreshed.body.access_token })
    assert.equal(account.status, 200)
  })

  it('revokes the session when an already-rotated refresh token is replayed', async () => {
    const session = await signUp()
    const first = await call('POST', '/auth/refresh', {
      body: {
        user_id: session.account.user_id,
        session_id: session.session_id,
        refresh_token: session.refresh_token,
      },
    })
    assert.equal(first.status, 200)

    // Replaying the original token is the signature of a stolen credential.
    const replay = await call('POST', '/auth/refresh', {
      body: {
        user_id: session.account.user_id,
        session_id: session.session_id,
        refresh_token: session.refresh_token,
      },
    })
    assert.equal(replay.status, 401)

    // The whole session chain dies, so the thief's rotated token is dead too.
    const afterReuse = await call('POST', '/auth/refresh', {
      body: {
        user_id: session.account.user_id,
        session_id: session.session_id,
        refresh_token: first.body.refresh_token,
      },
    })
    assert.equal(afterReuse.status, 401)
  })

  it('invalidates the access token immediately on sign-out', async () => {
    const session = await signUp()
    const before = await call('GET', '/account', { token: session.access_token })
    assert.equal(before.status, 200)

    await call('POST', '/auth/logout', { token: session.access_token })

    const after = await call('GET', '/account', { token: session.access_token })
    assert.equal(errorCode(after), 'AUTHENTICATION_REQUIRED')
  })
})

describe('multi-device consistency', () => {
  beforeEach(resetPlatform)

  it('gives every device the same account state', async () => {
    const machineA = await signUp('traveller@example.com', 'a long enough password')

    const machineB = await call('POST', '/auth/login', {
      body: {
        email: 'traveller@example.com',
        password: 'a long enough password',
        device: { device_id: 'dev-2', device_name: 'Laptop', platform: 'darwin' },
      },
    })
    assert.equal(machineB.status, 200)
    assert.notEqual(machineB.body.session_id, machineA.session_id)

    const [a, b] = await Promise.all([
      call('GET', '/account', { token: machineA.access_token }),
      call('GET', '/account', { token: machineB.body.access_token }),
    ])

    assert.equal(a.body.account.user_id, b.body.account.user_id)
    assert.deepEqual(a.body.entitlements, b.body.entitlements)
    assert.deepEqual(a.body.subscription, b.body.subscription)
  })

  it('lists both devices and signs out only the requesting one', async () => {
    const machineA = await signUp('two@example.com', 'a long enough password')
    const machineB = await call('POST', '/auth/login', {
      body: {
        email: 'two@example.com',
        password: 'a long enough password',
        device: { device_id: 'dev-2', device_name: 'Laptop', platform: 'darwin' },
      },
    })

    const sessions = await call('GET', '/auth/sessions', { token: machineA.access_token })
    assert.equal(sessions.body.sessions.length, 2)

    await call('POST', '/auth/logout', { token: machineA.access_token })

    const stillSignedIn = await call('GET', '/account', { token: machineB.body.access_token })
    assert.equal(stillSignedIn.status, 200)
  })

  it('signs every device out at once when asked', async () => {
    const machineA = await signUp('all@example.com', 'a long enough password')
    const machineB = await call('POST', '/auth/login', {
      body: { email: 'all@example.com', password: 'a long enough password' },
    })

    await call('POST', '/auth/logout-all', { token: machineA.access_token })

    const a = await call('GET', '/account', { token: machineA.access_token })
    const b = await call('GET', '/account', { token: machineB.body.access_token })
    assert.equal(errorCode(a), 'AUTHENTICATION_REQUIRED')
    assert.equal(errorCode(b), 'AUTHENTICATION_REQUIRED')
  })
})
