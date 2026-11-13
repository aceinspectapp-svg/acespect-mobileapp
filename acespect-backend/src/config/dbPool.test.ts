import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/app?schema=public';
process.env.JWT_ACCESS_SECRET ||= 'x'.repeat(32);
process.env.JWT_REFRESH_SECRET ||= 'y'.repeat(32);
delete process.env.DATABASE_CONNECTION_LIMIT;
delete process.env.DATABASE_POOL_TIMEOUT;

test("Prisma's pool size and wait are added to its URL (defaults 10 and 20 s); ones already in the URL win", async () => {
  const { withPrismaPool, withDatabaseTls } = await import('./env');
  const u = new URL(withPrismaPool('postgresql://u:p@db.example.com:5432/app?schema=public', 10, 20));
  assert.equal(u.searchParams.get('connection_limit'), '10');
  assert.equal(u.searchParams.get('pool_timeout'), '20');
  assert.equal(u.searchParams.get('schema'), 'public');
  const kept = new URL(withPrismaPool('postgresql://u:p@h/app?connection_limit=4&pool_timeout=0', 10, 20));
  assert.equal(kept.searchParams.get('connection_limit'), '4');
  assert.equal(kept.searchParams.get('pool_timeout'), '0');
  assert.equal(withPrismaPool('not a url', 10, 20), 'not a url');
  // Together with TLS on Azure: both sets of parameters, nothing lost.
  const azure = new URL(withPrismaPool(withDatabaseTls('postgresql://u:p@x.postgres.database.azure.com/app', 'auto'), 7, 30));
  assert.deepEqual(
    ['sslmode', 'sslaccept', 'connection_limit', 'pool_timeout'].map((k) => azure.searchParams.get(k)),
    ['require', 'strict', '7', '30'],
  );
});

test("only Prisma's URL carries the pool parameters; pg-boss's URL (env.DATABASE_URL) does not", async () => {
  const { env, prismaDatabaseUrl } = await import('./env');
  assert.equal(env.DATABASE_CONNECTION_LIMIT, 10);
  assert.equal(env.DATABASE_POOL_TIMEOUT, 20);
  assert.match(prismaDatabaseUrl, /connection_limit=10/);
  assert.match(prismaDatabaseUrl, /pool_timeout=20/);
  assert.equal(process.env.DATABASE_URL, prismaDatabaseUrl);
  assert.doesNotMatch(env.DATABASE_URL, /connection_limit|pool_timeout/);
});
