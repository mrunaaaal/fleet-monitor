import { buildApp } from './app.js';
import { createPostgresClient } from './db/postgres.js';
import { createClickhouseClient } from './db/clickhouse.js';
import { runMigrations } from './db/migrate.js';
import { runClickhouseMigrations } from './db/clickhouse-migrate.js';

const postgres = createPostgresClient();
const clickhouse = createClickhouseClient();
const app = buildApp({ postgres, clickhouse });
const port = Number(process.env.PORT ?? 3000);

Promise.all([runMigrations({ postgres }), runClickhouseMigrations({ clickhouse })])
  .then(() => app.listen({ host: '0.0.0.0', port }))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
