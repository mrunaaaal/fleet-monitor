import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerIngestRoute } from '../ingest/register-route.js';

test('registerIngestRoute returns 202/accepted when the handler resolves', async () => {
  const app = Fastify();
  const seen = [];
  registerIngestRoute(app, '/v1/fake', async (body) => {
    seen.push(body);
  });

  const res = await app.inject({ method: 'POST', url: '/v1/fake', payload: { a: 1 } });

  assert.equal(res.statusCode, 202);
  assert.deepEqual(JSON.parse(res.body), { status: 'accepted' });
  assert.deepEqual(seen, [{ a: 1 }]);
  await app.close();
});

test('registerIngestRoute returns 400/{ error } when the handler throws', async () => {
  const app = Fastify();
  registerIngestRoute(app, '/v1/fake', async () => {
    throw new Error('bad payload');
  });

  const res = await app.inject({ method: 'POST', url: '/v1/fake', payload: {} });

  assert.equal(res.statusCode, 400);
  assert.deepEqual(JSON.parse(res.body), { error: 'bad payload' });
  await app.close();
});

test('registerIngestRoute passes {} to the handler when the request body is missing', async () => {
  const app = Fastify();
  const seen = [];
  registerIngestRoute(app, '/v1/fake', async (body) => {
    seen.push(body);
  });

  await app.inject({ method: 'POST', url: '/v1/fake' });

  assert.deepEqual(seen, [{}]);
  await app.close();
});
