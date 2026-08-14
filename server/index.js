import { buildApp } from './app.js';
import { createPostgresClient } from './db/postgres.js';
import { createClickhouseClient } from './db/clickhouse.js';
import { createNeo4jClient } from './db/neo4j.js';
import { runMigrations } from './db/migrate.js';
import { runClickhouseMigrations } from './db/clickhouse-migrate.js';
import { runNeo4jMigrations } from './db/neo4j-migrate.js';

const postgres = createPostgresClient();
const clickhouse = createClickhouseClient();
const neo4j = createNeo4jClient();
const app = buildApp({ postgres, clickhouse, neo4j });
const port = Number(process.env.PORT ?? 3000);

Promise.all([runMigrations({ postgres }), runClickhouseMigrations({ clickhouse }), runNeo4jMigrations({ neo4j })])
  .then(() => app.listen({ host: '0.0.0.0', port }))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
