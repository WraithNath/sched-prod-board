import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000; // R4

const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const errorBox = document.querySelector('.error');
const backdrop = document.querySelector('.backdrop');
const confirmBox = document.querySelector('[data-testid="confirm"]');
const confirmAck = document.querySelector('[data-testid="confirm-ack"]');
const confirmCancel = document.querySelector('[data-testid="confirm-cancel"]');

/** Rows by incident id, so a refresh updates rows in place instead of rebuilding them. */
const rows = new Map();
/** Incident id -> ackedAt, kept across refreshes. */
const acked = new Map();

// R5: viewer's own zone and locale order (en-GB, de-DE, en-NZ … give day before month).
const timeFormat = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
});
const formatTime = (iso) => timeFormat.format(new Date(iso));

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function markAcked(row, ackedAt) {
  const slot = row.querySelector('.act');
  slot.replaceChildren(el('span', { 'data-testid': 'acked', class: 'acked', title: `acked ${ackedAt}` }, 'Acked'));
}

/**
 * Product decision (after step 1): Ack asks to confirm, and the confirm names the incident id.
 * The id is fixed when the row's button is clicked, and the dialog is fixed on screen, so a refresh
 * that moves rows cannot change what gets acked.
 */
let pending = null;
function askConfirm(i, row, button) {
  pending = { id: i.id, row, button };
  confirmBox.querySelector('.confirm-id').textContent = i.id;
  confirmBox.querySelector('.confirm-what').textContent = `${i.severity} · ${i.service} · ${i.region} · ${i.summary}`;
  confirmAck.textContent = `Ack ${i.id}`;
  backdrop.hidden = false;
  confirmCancel.focus();
}
function closeConfirm() {
  backdrop.hidden = true;
  const p = pending;
  pending = null;
  return p;
}
confirmAck.addEventListener('click', () => {
  const p = closeConfirm();
  if (p) onAck(p.id, p.row, p.button);
});
confirmCancel.addEventListener('click', () => {
  const p = closeConfirm();
  p?.button.focus();
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pending) confirmCancel.click();
});

async function onAck(id, row, button) {
  button.disabled = true;
  button.textContent = 'Acking…';
  try {
    const reply = await ack(id);
    acked.set(id, reply.ackedAt);
    markAcked(row, reply.ackedAt);
  } catch (err) {
    button.disabled = false;
    button.textContent = 'Ack';
    showError(`Ack failed for ${id}: ${err.message}`);
  }
}

function buildRow(i) {
  const row = el('li', { 'data-testid': 'incident-row', 'data-id': i.id, class: `row ${i.severity}` });
  row.append(
    el('span', { class: 'id' }, i.id),
    el('span', { class: 'sev' }, i.severity),
    el('span', { class: 'what' }, `${i.service} · ${i.region} · ${i.summary}`),
    el('time', { datetime: i.openedAt, title: i.openedAt }, formatTime(i.openedAt)),
  );
  const slot = el('span', { class: 'act' });
  row.append(slot);
  if (acked.has(i.id)) {
    markAcked(row, acked.get(i.id));
  } else {
    const button = el('button', { type: 'button', 'data-testid': 'ack' }, 'Ack');
    button.addEventListener('click', () => askConfirm(i, row, button));
    slot.append(button);
  }
  return row;
}

// R1: newest first; new incidents go in at the top, existing rows are kept as they are.
function render(incidents) {
  const sorted = [...incidents].sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
  const seen = new Set();
  sorted.forEach((i, index) => {
    seen.add(i.id);
    let row = rows.get(i.id);
    if (!row) {
      row = buildRow(i);
      rows.set(i.id, row);
    }
    const at = list.children[index];
    if (at !== row) list.insertBefore(row, at ?? null);
  });
  for (const [id, row] of rows) {
    if (!seen.has(id)) {
      row.remove();
      rows.delete(id);
    }
  }
  empty.hidden = sorted.length > 0;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

async function refresh() {
  try {
    const page = await fetchIncidents();
    render(page.incidents);
    errorBox.hidden = true;
  } catch (err) {
    showError(`Could not refresh: ${err.message}. Retrying…`);
  } finally {
    loader.hidden = true; // R3: gone once the first answer is in
    setTimeout(refresh, REFRESH_MS); // R4: no overlapping requests
  }
}

refresh();
