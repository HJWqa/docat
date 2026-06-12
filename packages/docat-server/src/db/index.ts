/**
 * SQLite 数据库初始化
 * 使用 better-sqlite3 实现零配置单文件数据库
 */
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ServerConfig } from '../config/index.js'

let db: Database.Database

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDb() first.')
  return db
}

export function initDb(config: ServerConfig): Database.Database {
  // 确保数据目录存在
  const dbDir = dirname(config.dbPath)
  mkdirSync(dbDir, { recursive: true })

  db = new Database(config.dbPath)

  // 启用 WAL 模式提升并发读写性能
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations(db)

  return db
}

function runMigrations(db: Database.Database): void {
  // 创建 schema_version 表追踪迁移
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      appliedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all()
      .map((r: unknown) => (r as { name: string }).name)
  )

  // ─── 001: 初始表结构 ───────────────────────────
  if (!applied.has('001_initial')) {
    db.exec(`
      -- 设备注册表
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        ip TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT '',
        autoConnect INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- 用户表
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        passwordHash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'operator' CHECK(role IN ('admin', 'operator', 'viewer')),
        createdAt TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- 会话表（记住登录，重启后仍有效）
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expiresAt TEXT NOT NULL,
        createdAt TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- 本地脚本
      CREATE TABLE IF NOT EXISTS scripts (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT 'Untitled',
        content TEXT NOT NULL DEFAULT '',
        language TEXT NOT NULL DEFAULT 'lua' CHECK(language IN ('lua', 'blockly')),
        deviceId TEXT,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- 操作日志
      CREATE TABLE IF NOT EXISTS auditLog (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        action TEXT NOT NULL,
        deviceId TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- 索引
      CREATE INDEX IF NOT EXISTS idx_devices_ip ON devices(ip);
      CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions(userId);
      CREATE INDEX IF NOT EXISTS idx_sessions_expiresAt ON sessions(expiresAt);
      CREATE INDEX IF NOT EXISTS idx_scripts_userId ON scripts(userId);
      CREATE INDEX IF NOT EXISTS idx_scripts_deviceId ON scripts(deviceId);
      CREATE INDEX IF NOT EXISTS idx_auditLog_userId ON auditLog(userId);
      CREATE INDEX IF NOT EXISTS idx_auditLog_deviceId ON auditLog(deviceId);
      CREATE INDEX IF NOT EXISTS idx_auditLog_createdAt ON auditLog(createdAt);
    `)

    db.prepare("INSERT INTO _migrations (name) VALUES ('001_initial')").run()
    console.log('[DB] Migration 001_initial applied')
  }

  // ─── 002: 设备级关节预设 ───────────────────────
  if (!applied.has('002_device_joint_presets')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS device_joint_presets (
        id TEXT PRIMARY KEY,
        deviceId TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        joints TEXT NOT NULL,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(deviceId, name)
      );

      CREATE INDEX IF NOT EXISTS idx_device_joint_presets_deviceId ON device_joint_presets(deviceId);
    `)

    db.prepare("INSERT INTO _migrations (name) VALUES ('002_device_joint_presets')").run()
    console.log('[DB] Migration 002_device_joint_presets applied')
  }

  // ─── 003: 脚本语言支持 Python ─────────────────
  if (!applied.has('003_scripts_python')) {
    db.exec(`
      ALTER TABLE scripts RENAME TO scripts_old;

      CREATE TABLE scripts (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT 'Untitled',
        content TEXT NOT NULL DEFAULT '',
        language TEXT NOT NULL DEFAULT 'lua' CHECK(language IN ('lua', 'python', 'blockly')),
        deviceId TEXT,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO scripts (id, userId, name, content, language, deviceId, createdAt, updatedAt)
      SELECT id, userId, name, content, language, deviceId, createdAt, updatedAt FROM scripts_old;

      DROP TABLE scripts_old;

      CREATE INDEX IF NOT EXISTS idx_scripts_userId ON scripts(userId);
      CREATE INDEX IF NOT EXISTS idx_scripts_deviceId ON scripts(deviceId);
    `)

    db.prepare("INSERT INTO _migrations (name) VALUES ('003_scripts_python')").run()
    console.log('[DB] Migration 003_scripts_python applied')
  }

  // ─── 004: 最近打开的控制器工程 ─────────────────
  if (!applied.has('004_recent_projects')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS recent_projects (
        userId TEXT NOT NULL,
        deviceId TEXT NOT NULL,
        projectName TEXT NOT NULL,
        projectPath TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'lua',
        openedAt TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (userId, deviceId, projectName)
      );

      CREATE INDEX IF NOT EXISTS idx_recent_projects_user_device ON recent_projects(userId, deviceId, openedAt);
    `)

    db.prepare("INSERT INTO _migrations (name) VALUES ('004_recent_projects')").run()
    console.log('[DB] Migration 004_recent_projects applied')
  }

  // ─── 005: 关节预设排序字段 ─────────────────────
  if (!applied.has('005_preset_sort_order')) {
    db.exec(`
      ALTER TABLE device_joint_presets ADD COLUMN sortOrder INTEGER NOT NULL DEFAULT 0;
    `)

    db.prepare("INSERT INTO _migrations (name) VALUES ('005_preset_sort_order')").run()
    console.log('[DB] Migration 005_preset_sort_order applied')
  }

  console.log(`[DB] Database ready at ${db.name}`)
}

export function closeDb(): void {
  if (db) {
    db.close()
  }
}
