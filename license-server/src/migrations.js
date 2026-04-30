const { logger } = require('./logger');

const MIGRATIONS = [
  {
    version: 1,
    name: 'multi_tenant_schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tenants (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          slug        TEXT NOT NULL UNIQUE,
          seat_quota  INTEGER NOT NULL DEFAULT 0,
          status      TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'suspended')),
          created_at  TEXT NOT NULL,
          notes       TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

        CREATE TABLE IF NOT EXISTS tenant_admins (
          id             TEXT PRIMARY KEY,
          tenant_id      TEXT,
          username       TEXT NOT NULL UNIQUE,
          password_hash  TEXT NOT NULL,
          role           TEXT NOT NULL
                         CHECK (role IN ('super', 'tenant_admin')),
          status         TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'disabled')),
          display_name   TEXT,
          created_at     TEXT NOT NULL,
          last_login_at  TEXT,
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
          CHECK (
            (role = 'super' AND tenant_id IS NULL)
            OR (role = 'tenant_admin' AND tenant_id IS NOT NULL)
          )
        );
        CREATE INDEX IF NOT EXISTS idx_tenant_admins_tenant ON tenant_admins(tenant_id);
      `);

      const cols = db.prepare("PRAGMA table_info(licenses)").all();
      const hasTenantId = cols.some((c) => c.name === 'tenant_id');
      if (!hasTenantId) {
        db.exec(`ALTER TABLE licenses ADD COLUMN tenant_id TEXT REFERENCES tenants(id)`);
      }

      const defaultExists = db
        .prepare("SELECT 1 FROM tenants WHERE id = 'default'")
        .get();
      if (!defaultExists) {
        db.prepare(`
          INSERT INTO tenants (id, name, slug, seat_quota, status, created_at, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          'default',
          '默认租户（v0 迁移）',
          'default',
          9999,
          'active',
          new Date().toISOString(),
          '从单租户模式迁移过来的存量 license 默认归入此租户'
        );
      }

      db.prepare(`UPDATE licenses SET tenant_id = 'default' WHERE tenant_id IS NULL`).run();
      db.exec(`CREATE INDEX IF NOT EXISTS idx_licenses_tenant ON licenses(tenant_id)`);
    }
  }
];

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_version').all().map((r) => r.version)
  );

  const insert = db.prepare(
    'INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)'
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    logger.info({ version: migration.version, name: migration.name }, 'applying migration');
    const tx = db.transaction(() => {
      migration.up(db);
      insert.run(migration.version, migration.name, new Date().toISOString());
    });
    tx();
    logger.info({ version: migration.version }, 'migration applied');
  }
}

module.exports = { runMigrations, MIGRATIONS };
