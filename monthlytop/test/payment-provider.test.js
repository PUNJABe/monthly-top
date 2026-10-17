const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monthlytop-vercel-payments-'));
process.env.VERCEL = '1';
process.env.NODE_ENV = 'production';
process.env.DATA_DIR = dataDir;
process.env.BASE_URL = 'https://monthlytop.test';
for (const key of ['PAYMENT_PROVIDER', 'STRIPE_SECRET_KEY', 'DATABASE_URL', 'POSTGRES_URL', 'YOUPI_API_URL', 'YOUPI_MERCHANT_ID', 'YOUPI_WEBHOOK_SECRET']) delete process.env[key];

const app = require('../server');

test('Vercel without provider credentials keeps samples but disables demo payment', async (context) => {
  const server = app.listen(0, '127.0.0.1');
  context.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const configResponse = await fetch(`${baseUrl}/api/config`);
  const config = await configResponse.json();
  assert.equal(config.demo, false);
  assert.equal(config.paymentProvider, 'unconfigured');
  assert.equal(config.paymentReady, false);
  assert.ok(config.categories.length > 0);

  const boostResponse = await fetch(`${baseUrl}/api/boost`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amountCents: 1000,
      email: 'buyer@example.com',
      acceptTerms: true,
      url: 'unconfigured-payment.example',
      title: 'Payment Test Listing',
      description: 'A listing for the unconfigured payment test.',
      category: 'other',
    }),
  });
  assert.equal(boostResponse.status, 503);
  assert.match((await boostResponse.json()).error, /not configured/i);
});
