import neo4j from 'neo4j-driver';

const DEFAULT_URL = 'bolt://localhost:7687';
const DEFAULT_USER = 'neo4j';
// Matches .env.example's local-dev default so this works out of the box
// against `docker compose up -d neo4j`, the same way postgres.js/redis.js
// default to their local-dev credentials.
const DEFAULT_PASSWORD = 'changeme12345';

// Thin wrapper over the neo4j-driver: run() opens a session per call and
// returns plain-object records (record.toObject()), closing the session
// when done. No Cypher here — that's ingest/topology.js and
// query/topology.js.
export function createNeo4jClient({
  url = process.env.NEO4J_URL ?? DEFAULT_URL,
  user = process.env.NEO4J_USER ?? DEFAULT_USER,
  password = process.env.NEO4J_PASSWORD ?? DEFAULT_PASSWORD,
  driverFactory = (u, auth) => neo4j.driver(u, auth),
} = {}) {
  const driver = driverFactory(url, neo4j.auth.basic(user, password));

  async function run(cypher, params = {}) {
    const session = driver.session();
    try {
      const result = await session.run(cypher, params);
      return result.records.map((record) => record.toObject());
    } finally {
      await session.close();
    }
  }

  async function close() {
    await driver.close();
  }

  return { run, close };
}
