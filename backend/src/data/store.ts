/**
 * Single-table data access.
 *
 * The interface is deliberately semantic (`add` for atomic counters,
 * `ifNotExists` for uniqueness) rather than a thin wrapper over DynamoDB
 * expression syntax. Repositories stay readable, and the whole platform can run
 * against an in-memory store in tests without mocking the AWS SDK.
 */
import { config } from '../lib/config.js'

export type Item = Record<string, unknown> & { pk: string; sk: string }

export type UpdateChanges = {
  set?: Record<string, unknown>
  /** Atomic numeric increments. Negative values decrement. */
  add?: Record<string, number>
  remove?: string[]
}

/**
 * Reads are generic over the caller's entity type rather than constrained to
 * `Item`. Intersecting an entity with `Item`'s index signature widens every
 * named field to `unknown`, so entity types declare their own `pk`/`sk`
 * instead of extending the storage shape.
 */
export interface DataStore {
  get<T>(pk: string, sk: string): Promise<T | null>
  /** Returns false when `ifNotExists` is set and the item already exists. */
  put(item: Item, options?: { ifNotExists?: boolean }): Promise<boolean>
  update(
    pk: string,
    sk: string,
    changes: UpdateChanges,
    options?: { ifExists?: boolean },
  ): Promise<Item>
  query<T>(
    pk: string,
    skPrefix?: string,
    options?: { limit?: number; descending?: boolean },
  ): Promise<T[]>
  queryIndex<T>(gsi1pk: string, gsi1sk?: string): Promise<T[]>
  delete(pk: string, sk: string): Promise<void>
}

class ConditionFailed extends Error {}

/** In-memory store used by the test suite and local development. */
export class MemoryStore implements DataStore {
  private items = new Map<string, Item>()

  private key(pk: string, sk: string) {
    return `${pk}\u0000${sk}`
  }

  async get<T>(pk: string, sk: string): Promise<T | null> {
    const found = this.items.get(this.key(pk, sk))
    return found ? (structuredClone(found) as T) : null
  }

  async put(item: Item, options: { ifNotExists?: boolean } = {}): Promise<boolean> {
    const key = this.key(item.pk, item.sk)
    if (options.ifNotExists && this.items.has(key)) return false
    this.items.set(key, structuredClone(item))
    return true
  }

  async update(
    pk: string,
    sk: string,
    changes: UpdateChanges,
    options: { ifExists?: boolean } = {},
  ): Promise<Item> {
    const key = this.key(pk, sk)
    const existing = this.items.get(key)
    if (!existing && options.ifExists) throw new ConditionFailed('Item does not exist')
    const next: Item = existing ? structuredClone(existing) : { pk, sk }
    for (const [field, value] of Object.entries(changes.set ?? {})) next[field] = value
    for (const [field, delta] of Object.entries(changes.add ?? {})) {
      next[field] = (typeof next[field] === 'number' ? (next[field] as number) : 0) + delta
    }
    for (const field of changes.remove ?? []) delete next[field]
    this.items.set(key, next)
    return structuredClone(next)
  }

  async query<T>(
    pk: string,
    skPrefix = '',
    options: { limit?: number; descending?: boolean } = {},
  ): Promise<T[]> {
    let rows = [...this.items.values()].filter(
      (item) => item.pk === pk && item.sk.startsWith(skPrefix),
    )
    rows.sort((a, b) => (a.sk < b.sk ? -1 : a.sk > b.sk ? 1 : 0))
    if (options.descending) rows.reverse()
    if (options.limit) rows = rows.slice(0, options.limit)
    return structuredClone(rows) as T[]
  }

  async queryIndex<T>(gsi1pk: string, gsi1sk?: string): Promise<T[]> {
    const rows = [...this.items.values()].filter(
      (item) => item.gsi1pk === gsi1pk && (!gsi1sk || item.gsi1sk === gsi1sk),
    )
    return structuredClone(rows) as T[]
  }

  async delete(pk: string, sk: string): Promise<void> {
    this.items.delete(this.key(pk, sk))
  }

  clear() {
    this.items.clear()
  }
}

class DynamoStore implements DataStore {
  private clientPromise: Promise<import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient> | null =
    null

  private async client() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb')
        const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb')
        return DynamoDBDocumentClient.from(new DynamoDBClient({}), {
          marshallOptions: { removeUndefinedValues: true },
        })
      })()
    }
    return this.clientPromise
  }

  async get<T>(pk: string, sk: string): Promise<T | null> {
    const { GetCommand } = await import('@aws-sdk/lib-dynamodb')
    const client = await this.client()
    const result = await client.send(
      new GetCommand({ TableName: config.tableName, Key: { pk, sk } }),
    )
    return (result.Item as T) ?? null
  }

  async put(item: Item, options: { ifNotExists?: boolean } = {}): Promise<boolean> {
    const { PutCommand } = await import('@aws-sdk/lib-dynamodb')
    const client = await this.client()
    try {
      await client.send(
        new PutCommand({
          TableName: config.tableName,
          Item: item,
          ...(options.ifNotExists
            ? { ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)' }
            : {}),
        }),
      )
      return true
    } catch (err) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return false
      throw err
    }
  }

  async update(
    pk: string,
    sk: string,
    changes: UpdateChanges,
    options: { ifExists?: boolean } = {},
  ): Promise<Item> {
    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb')
    const client = await this.client()

    const names: Record<string, string> = {}
    const values: Record<string, unknown> = {}
    const clauses: string[] = []

    const setEntries = Object.entries(changes.set ?? {})
    if (setEntries.length) {
      clauses.push(
        `SET ${setEntries
          .map(([field, value], i) => {
            names[`#s${i}`] = field
            values[`:s${i}`] = value
            return `#s${i} = :s${i}`
          })
          .join(', ')}`,
      )
    }

    const addEntries = Object.entries(changes.add ?? {})
    if (addEntries.length) {
      clauses.push(
        `ADD ${addEntries
          .map(([field, delta], i) => {
            names[`#a${i}`] = field
            values[`:a${i}`] = delta
            return `#a${i} :a${i}`
          })
          .join(', ')}`,
      )
    }

    const removeFields = changes.remove ?? []
    if (removeFields.length) {
      clauses.push(
        `REMOVE ${removeFields
          .map((field, i) => {
            names[`#r${i}`] = field
            return `#r${i}`
          })
          .join(', ')}`,
      )
    }

    const result = await client.send(
      new UpdateCommand({
        TableName: config.tableName,
        Key: { pk, sk },
        UpdateExpression: clauses.join(' '),
        ExpressionAttributeNames: names,
        ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
        ...(options.ifExists ? { ConditionExpression: 'attribute_exists(pk)' } : {}),
        ReturnValues: 'ALL_NEW',
      }),
    )
    return result.Attributes as Item
  }

  async query<T>(
    pk: string,
    skPrefix = '',
    options: { limit?: number; descending?: boolean } = {},
  ): Promise<T[]> {
    const { QueryCommand } = await import('@aws-sdk/lib-dynamodb')
    const client = await this.client()
    const result = await client.send(
      new QueryCommand({
        TableName: config.tableName,
        KeyConditionExpression: skPrefix
          ? '#pk = :pk AND begins_with(#sk, :sk)'
          : '#pk = :pk',
        ExpressionAttributeNames: { '#pk': 'pk', ...(skPrefix ? { '#sk': 'sk' } : {}) },
        ExpressionAttributeValues: { ':pk': pk, ...(skPrefix ? { ':sk': skPrefix } : {}) },
        ...(options.limit ? { Limit: options.limit } : {}),
        ScanIndexForward: !options.descending,
      }),
    )
    return (result.Items as T[]) ?? []
  }

  async queryIndex<T>(gsi1pk: string, gsi1sk?: string): Promise<T[]> {
    const { QueryCommand } = await import('@aws-sdk/lib-dynamodb')
    const client = await this.client()
    const result = await client.send(
      new QueryCommand({
        TableName: config.tableName,
        IndexName: 'gsi1',
        KeyConditionExpression: gsi1sk ? '#pk = :pk AND #sk = :sk' : '#pk = :pk',
        ExpressionAttributeNames: { '#pk': 'gsi1pk', ...(gsi1sk ? { '#sk': 'gsi1sk' } : {}) },
        ExpressionAttributeValues: { ':pk': gsi1pk, ...(gsi1sk ? { ':sk': gsi1sk } : {}) },
      }),
    )
    return (result.Items as T[]) ?? []
  }

  async delete(pk: string, sk: string): Promise<void> {
    const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb')
    const client = await this.client()
    await client.send(new DeleteCommand({ TableName: config.tableName, Key: { pk, sk } }))
  }
}

let active: DataStore | null = null

export function store(): DataStore {
  if (!active) active = config.isTest ? new MemoryStore() : new DynamoStore()
  return active
}

/** Test hook: swap in a deterministic store. */
export function setStore(next: DataStore | null): void {
  active = next
}

/** Seconds-since-epoch TTL value `days` in the future. */
export const ttlInDays = (days: number): number =>
  Math.floor(Date.now() / 1000) + days * 24 * 60 * 60

export const ttlInSeconds = (seconds: number): number =>
  Math.floor(Date.now() / 1000) + seconds
