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
  },

  {
    version: 2,
    name: 'departments',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS departments (
          id          TEXT PRIMARY KEY,
          tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name        TEXT NOT NULL,
          abbrev      TEXT NOT NULL,
          status      TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'archived')),
          created_at  TEXT NOT NULL,
          created_by  TEXT,
          UNIQUE (tenant_id, abbrev),
          UNIQUE (tenant_id, name)
        );
        CREATE INDEX IF NOT EXISTS idx_departments_tenant ON departments(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_departments_status ON departments(status);
      `);
    }
  },

  {
    version: 3,
    name: 'tenant_employees',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tenant_employees (
          id                   TEXT PRIMARY KEY,
          tenant_id            TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          department_id        TEXT NOT NULL REFERENCES departments(id),
          username             TEXT NOT NULL,
          raw_username         TEXT NOT NULL,
          password_hash        TEXT NOT NULL,
          display_name         TEXT,
          status               TEXT NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'suspended', 'deleted')),
          machine_fingerprint  TEXT,
          bound_at             TEXT,
          last_login_at        TEXT,
          password_changed_at  TEXT,
          created_at           TEXT NOT NULL,
          created_by           TEXT,
          UNIQUE (tenant_id, username)
        );
        CREATE INDEX IF NOT EXISTS idx_employees_tenant ON tenant_employees(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_employees_dept   ON tenant_employees(department_id);
        CREATE INDEX IF NOT EXISTS idx_employees_status ON tenant_employees(status);
        CREATE INDEX IF NOT EXISTS idx_employees_fp     ON tenant_employees(machine_fingerprint);
      `);
    }
  },

  {
    version: 4,
    name: 'invite_codes',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS invite_codes (
          code                 TEXT PRIMARY KEY,
          tenant_id            TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          department_id        TEXT NOT NULL REFERENCES departments(id),
          raw_username         TEXT NOT NULL,
          display_name         TEXT,
          used_at              TEXT,
          used_by_employee_id  TEXT REFERENCES tenant_employees(id),
          expires_at           TEXT NOT NULL,
          created_at           TEXT NOT NULL,
          created_by           TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_invite_codes_tenant  ON invite_codes(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_invite_codes_expires ON invite_codes(expires_at);
        CREATE INDEX IF NOT EXISTS idx_invite_codes_used    ON invite_codes(used_at);
      `);
    }
  },

  {
    version: 5,
    name: 'seats_add_employee',
    up: (db) => {
      const cols = db.prepare("PRAGMA table_info(seats)").all();
      const hasEmployee = cols.some((c) => c.name === 'employee_id');
      if (!hasEmployee) {
        db.exec(`ALTER TABLE seats ADD COLUMN employee_id TEXT REFERENCES tenant_employees(id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_seats_employee ON seats(employee_id)`);
      }
    }
  },

  {
    version: 6,
    name: 'installer_builds',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS installer_builds (
          id            TEXT PRIMARY KEY,
          tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          status        TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'building', 'succeeded', 'failed')),
          worker_kind   TEXT NOT NULL DEFAULT 'manual'
                        CHECK (worker_kind IN ('manual', 'gh_actions')),
          bundle_json   TEXT NOT NULL,
          download_url  TEXT,
          error         TEXT,
          requested_by  TEXT NOT NULL,
          requested_at  TEXT NOT NULL,
          claimed_at    TEXT,
          completed_at  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_installer_builds_tenant ON installer_builds(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_installer_builds_status ON installer_builds(status);
        CREATE INDEX IF NOT EXISTS idx_installer_builds_queue
          ON installer_builds(status, requested_at);
      `);
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
