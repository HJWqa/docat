import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initDb, closeDb, getDb } from '../db/index.js'
import { hashPassword, verifyPassword } from '../auth/password.js'
import { createSession, validateToken, destroySession } from '../auth/auth.js'

const TEST_CONFIG = {
  port: 0,
  host: '127.0.0.1',
  dbPath: ':memory:',
  cacheDir: ':memory:',
  orchScriptsDir: ':memory:',
  scanIps: ['127.0.0.1'],
  pollInterval: 500,
  logLevel: 'error' as const,
  autoConnect: false,
  sessionExpireDays: 30,
}

beforeEach(() => {
  initDb(TEST_CONFIG)
})

afterEach(() => {
  closeDb()
})

describe('database (better-sqlite3)', () => {
  it('runs migrations and creates core tables', () => {
    const db = getDb()
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r: unknown) => (r as { name: string }).name)

    for (const expected of ['devices', 'users', 'sessions', 'scripts', 'device_joint_presets', 'recent_projects', 'app_settings', 'auditLog']) {
      expect(tables).toContain(expected)
    }
  })

  it('inserts and reads back a device row', () => {
    const db = getDb()
    db.prepare('INSERT INTO devices (id, ip, name, type) VALUES (?, ?, ?, ?)').run(
      'dev-1',
      '192.168.1.50',
      'Test Arm',
      'E6'
    )

    const row = db.prepare('SELECT id, ip, name, type FROM devices WHERE id = ?').get('dev-1') as {
      id: string
      ip: string
      name: string
      type: string
    }

    expect(row).toMatchObject({ id: 'dev-1', ip: '192.168.1.50', name: 'Test Arm', type: 'E6' })
  })
})

describe('password hashing (bcrypt)', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash).not.toBe('correct horse battery staple')
    expect(hash.startsWith('$2')).toBe(true)

    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true)
    expect(await verifyPassword('wrong-password', hash)).toBe(false)
  })
})

describe('auth session (uuid + sqlite)', () => {
  it('creates, validates and destroys a session token', () => {
    const db = getDb()
    db.prepare("INSERT INTO users (id, username, passwordHash, role) VALUES (?, ?, ?, 'admin')").run(
      'user-1',
      'admin',
      'not-a-real-hash'
    )

    const session = createSession('user-1', 30)
    expect(session.token).toBeTruthy()
    expect(session.username).toBe('admin')
    expect(session.role).toBe('admin')

    const validated = validateToken(session.token)
    expect(validated?.userId).toBe('user-1')

    destroySession(session.token)
    expect(validateToken(session.token)).toBeNull()
  })

  it('rejects an unknown or expired token', () => {
    expect(validateToken('definitely-not-a-real-token')).toBeNull()
  })
})
