// Checks R1–R6 against a mocked incident API. Run: node scripts/build.mjs test-sha && node tests/board.test.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { serve } from './serve.mjs';

const server = await serve('dist', 4173);
const browser = await chromium.launch({ channel: 'msedge' });
let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures++; console.log(`FAIL ${name}\n     ${e.message}`); }
}

function mockApi(page, state) {
  return page.route('**/challenges/show-me-when/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/incidents')) {
      state.calls++;
      if (state.delay) await new Promise((r) => setTimeout(r, state.delay));
      return route.fulfill({ json: { updatedAt: new Date().toISOString(), incidents: state.incidents, cursor: `c${state.calls}` } });
    }
    if (url.pathname.endsWith('/ack')) {
      state.acks.push({ id: url.searchParams.get('id'), cursor: url.searchParams.get('cursor') });
      return route.fulfill({ json: { id: url.searchParams.get('id'), ackedAt: new Date().toISOString(), receipt: 'r' } });
    }
    route.abort();
  });
}
const inc = (id, openedAt) => ({ id, service: 'svc', region: 'eu', summary: `s ${id}`, severity: 'sev2', openedAt });

async function newPage(state, ctx = {}) {
  const context = await browser.newContext(ctx);
  const page = await context.newPage();
  await mockApi(page, state);
  await page.goto('http://localhost:4173/');
  return page;
}

await check('R3 loader shows, then goes once incidents load', async () => {
  const state = { calls: 0, acks: [], delay: 800, incidents: [inc('INC-1', '2026-11-12T03:03:00.000Z')] };
  const page = await newPage(state);
  assert.equal(await page.getByTestId('loader').isVisible(), true);
  await page.getByTestId('incident-row').first().waitFor();
  assert.equal(await page.getByTestId('loader').isVisible(), false);
});

await check('empty state when there are no incidents', async () => {
  const page = await newPage({ calls: 0, acks: [], incidents: [] });
  await page.getByTestId('empty').waitFor();
  assert.equal(await page.getByTestId('incident-row').count(), 0);
});

await check('R1+R4 new incident appears at top without reload; refresh every ~2s; ack mark survives refresh', async () => {
  const state = { calls: 0, acks: [], incidents: [inc('INC-1', '2026-11-12T03:03:00.000Z')] };
  const page = await newPage(state);
  await page.locator('[data-id="INC-1"] [data-testid="ack"]').click();
  await page.locator('[data-id="INC-1"] [data-testid="acked"]').waitFor();
  assert.equal(state.acks[0].id, 'INC-1');
  state.incidents = [inc('INC-2', '2026-11-12T04:00:00.000Z'), ...state.incidents];
  const callsBefore = state.calls;
  await page.waitForTimeout(4500);
  assert.ok(state.calls - callsBefore >= 2 && state.calls - callsBefore <= 3, `calls in 4.5s: ${state.calls - callsBefore}`);
  const ids = await page.getByTestId('incident-row').evaluateAll((rs) => rs.map((r) => r.dataset.id));
  assert.deepEqual(ids, ['INC-2', 'INC-1']);
  assert.equal(await page.locator('[data-id="INC-1"] [data-testid="acked"]').count(), 1);
  assert.equal(await page.locator('[data-id="INC-2"] [data-testid="ack"]').count(), 1);
});

await check('R2 ack sends the latest cursor', async () => {
  const state = { calls: 0, acks: [], incidents: [inc('INC-1', '2026-11-12T03:03:00.000Z')] };
  const page = await newPage(state);
  await page.waitForTimeout(2500);
  await page.locator('[data-id="INC-1"] [data-testid="ack"]').click();
  await page.locator('[data-testid="acked"]').waitFor();
  assert.equal(state.acks[0].cursor, `c${state.calls}`);
});

for (const [tz, locale, want] of [
  ['Europe/Berlin', 'de-DE', /12\.11\.?,? 04:03/],
  ['Pacific/Auckland', 'en-NZ', /12\/11,? (16:03|0?4:03\s?pm) NZDT/i], // UTC+13 in November
  ['America/New_York', 'en-US', /11\/11,? 10:03/],
]) {
  await check(`R5 local time ${tz} ${locale}`, async () => {
    const page = await newPage({ calls: 0, acks: [], incidents: [inc('INC-1', '2026-11-12T03:03:00.000Z')] }, { timezoneId: tz, locale });
    const t = page.locator('[data-id="INC-1"] time');
    await t.waitFor();
    const text = await t.textContent();
    assert.match(text, want, text);
    assert.equal(await t.getAttribute('datetime'), '2026-11-12T03:03:00.000Z');
  });
}

await check('R6 build sha in meta and footer', async () => {
  const page = await newPage({ calls: 0, acks: [], incidents: [] });
  assert.equal(await page.locator('meta[name="build"]').getAttribute('content'), 'test-sha');
  assert.equal(await page.getByTestId('build-sha').textContent(), 'test-sha');
});

await check('summary text is escaped', async () => {
  const page = await newPage({ calls: 0, acks: [], incidents: [{ ...inc('INC-X', '2026-11-12T03:03:00.000Z'), summary: '<img src=x onerror=alert(1)>' }] });
  await page.getByTestId('incident-row').waitFor();
  assert.equal(await page.locator('.row img').count(), 0);
});

await browser.close();
server.close();
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
