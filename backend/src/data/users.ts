import { store, type Item } from './store.js'
import { hashPassword, newId, verifyPassword } from '../lib/crypto.js'
import { conflict } from '../lib/errors.js'

export type AccountStatus = 'active' | 'suspended' | 'deleted'

export type User = {
  pk: string
  sk: string
  entity: 'user'
  userId: string
  email: string
  passwordHash: string
  status: AccountStatus
  createdAt: string
  updatedAt: string
}

const userKey = (userId: string) => ({ pk: `USER#${userId}`, sk: 'PROFILE' })
const emailKey = (email: string) => ({ pk: `EMAIL#${email.toLowerCase()}`, sk: 'USER' })

export async function createUser(email: string, password: string): Promise<User> {
  const userId = newId('usr')
  const now = new Date().toISOString()

  // Claim the email first. A conditional put is what makes uniqueness real
  // under concurrent signups; checking-then-writing would race.
  const claimed = await store().put(
    { ...emailKey(email), entity: 'emailIndex', userId, createdAt: now },
    { ifNotExists: true },
  )
  if (!claimed) throw conflict('An account with that email already exists.')

  const user: User = {
    ...userKey(userId),
    entity: 'user',
    userId,
    email: email.toLowerCase(),
    passwordHash: await hashPassword(password),
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await store().put(user)
  return user
}

export async function findUserById(userId: string): Promise<User | null> {
  const key = userKey(userId)
  return store().get<User>(key.pk, key.sk)
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const key = emailKey(email)
  const index = await store().get<{ userId: string }>(key.pk, key.sk)
  if (!index) return null
  return findUserById(index.userId)
}

/** Constant-ish time: always hashes so a missing account is not timing-visible. */
export async function authenticate(email: string, password: string): Promise<User | null> {
  const user = await findUserByEmail(email)
  const hash = user?.passwordHash ?? (await placeholderHash())
  const matches = await verifyPassword(password, hash)
  if (!user || !matches) return null
  return user
}

let placeholder: Promise<string> | null = null
function placeholderHash(): Promise<string> {
  if (!placeholder) placeholder = hashPassword('placeholder-not-a-real-password')
  return placeholder
}

export async function setUserStatus(userId: string, status: AccountStatus): Promise<void> {
  const key = userKey(userId)
  await store().update(key.pk, key.sk, {
    set: { status, updatedAt: new Date().toISOString() },
  })
}
