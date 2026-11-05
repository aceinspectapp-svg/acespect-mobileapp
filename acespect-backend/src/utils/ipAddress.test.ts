import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { bareIp } from './ipAddress';

test('bareIp drops the port from IPv4 and IPv6 addresses', () => {
  assert.equal(bareIp('112.134.170.168:39123'), '112.134.170.168');
  assert.equal(bareIp('[2001:db8::1]:5678'), '2001:db8::1');
  assert.equal(bareIp('[::1]:5678'), '::1');
  assert.equal(bareIp('[::1]'), '::1');
  assert.equal(bareIp(' 1.2.3.4:80 '), '1.2.3.4');
});

test('bareIp leaves a plain address alone', () => {
  assert.equal(bareIp('1.2.3.4'), '1.2.3.4');
  assert.equal(bareIp('::1'), '::1');
  assert.equal(bareIp('2001:db8::1'), '2001:db8::1');
  assert.equal(bareIp('::ffff:1.2.3.4'), '::ffff:1.2.3.4');
});

test('bareIp refuses anything that is not an address', () => {
  for (const bad of ['', '   ', undefined, null, 'unknown', 'example.com:80', '1.2.3.4:', '1.2.3.4:abc', '1.2.3.4:99999', '999.1.1.1:80', '[1.2.3.4]:80', '[::1]:', '[::1]:70000', '1.2.3.4:80:90']) {
    assert.equal(bareIp(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('behind one proxy, req.ip is the bare client address when X-Forwarded-For carries IP:port', async () => {
  process.env.DATABASE_URL ||= 'postgresql://x:x@localhost:5432/x';
  process.env.JWT_ACCESS_SECRET ||= 'x'.repeat(32);
  process.env.JWT_REFRESH_SECRET ||= 'y'.repeat(32);
  const { clientIp } = await import('../middleware/clientIp');
  const app = express();
  app.set('trust proxy', 1);
  app.use(clientIp);
  app.get('/', (req, res) => res.send(req.ip));
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const ask = (xff: string) => new Promise<string>((resolve, reject) => {
      http.get({ port, headers: { 'x-forwarded-for': xff } }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve(b)); }).on('error', reject);
    });
    assert.equal(await ask('112.134.170.168:39123'), '112.134.170.168');
    assert.equal(await ask('[2001:db8::7]:4000'), '2001:db8::7');
    assert.equal(await ask('6.6.6.6, 112.134.170.168:39123'), '112.134.170.168', 'only the one Azure front end is trusted: the last hop counts');
    assert.equal(await ask('112.134.170.168'), '112.134.170.168');
  } finally {
    server.close();
  }
});
