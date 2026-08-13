import { buildApp } from './app.js';
import { createPostgresClient } from './db/postgres.js';
import { runMigrations } from './db/migrate.js';

const postgres = createPostgresClient();
const app = buildApp({ postgres });
const port = Number(process.env.PORT ?? 3000);

runMigrations({ postgres })
  .then(() => app.listen({ host: '0.0.0.0', port }))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
