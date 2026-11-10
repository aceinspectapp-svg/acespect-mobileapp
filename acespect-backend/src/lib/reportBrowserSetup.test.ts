import test from 'node:test';
import assert from 'node:assert/strict';

test('report Chrome set-up only runs on Azure App Service, and never overrides an explicit PUPPETEER_EXECUTABLE_PATH', async () => {
  const saved = { site: process.env.WEBSITE_SITE_NAME, exe: process.env.PUPPETEER_EXECUTABLE_PATH };
  try {
    const { reportBrowserPath } = await import('./reportBrowserSetup');
    delete process.env.WEBSITE_SITE_NAME;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    assert.equal(await reportBrowserPath(), null, 'local development: puppeteer default');
    process.env.WEBSITE_SITE_NAME = 'acespect-api-prod';
    process.env.PUPPETEER_EXECUTABLE_PATH = '/usr/bin/chromium-browser';
    assert.equal(await reportBrowserPath(), null, 'Docker image: its own chromium wins');
  } finally {
    if (saved.site === undefined) delete process.env.WEBSITE_SITE_NAME; else process.env.WEBSITE_SITE_NAME = saved.site;
    if (saved.exe === undefined) delete process.env.PUPPETEER_EXECUTABLE_PATH; else process.env.PUPPETEER_EXECUTABLE_PATH = saved.exe;
  }
});
