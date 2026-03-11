/**
 * useDatabase — initialises an in-memory sql.js database with the Kit schema.
 *
 * The sql-wasm.wasm file must be served from the public root.
 * Once the DB is ready, the returned `db` value is stable for the lifetime
 * of the app. This hook is meant to be called once at the root level.
 */

import { useEffect, useState } from 'react';
import type { Database } from 'sql.js';
import initSqlJs from 'sql.js';
import { ALL_TABLES, ENABLE_FOREIGN_KEYS } from '../lib/db';
import { configureSqlJsPath } from '../lib/apkg';

export interface UseDatabaseReturn {
  db: Database | null;
  /** True while the WASM is loading or the schema is being applied. */
  loading: boolean;
  /** Non-empty string if initialisation failed. */
  error: string;
}

/**
 * Initialise a sql.js in-memory database and apply the Kit schema.
 *
 * @returns Reactive database handle, loading flag, and any error message.
 */
export function useDatabase(): UseDatabaseReturn {
  const [db, setDb] = useState<Database | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // The browser build of sql.js resolves "sql-wasm-browser.wasm" via locateFile.
        // We use the same locateFile for both the DB and the .apkg parser so they share
        // one WASM binary served from the public root.
        const locateFile = (file: string) => `/${file}`;
        configureSqlJsPath(locateFile);

        const SQL = await initSqlJs({ locateFile });

        if (cancelled) return;

        const database = new SQL.Database();

        // Enable foreign-key enforcement on this connection.
        database.run(ENABLE_FOREIGN_KEYS);

        // Create all tables (IF NOT EXISTS — idempotent).
        for (const ddl of ALL_TABLES) {
          database.run(ddl);
        }

        setDb(database);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  return { db, loading, error };
}
