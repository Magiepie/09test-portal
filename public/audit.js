const entriesElement = document.querySelector('#audit-entries');
const messageElement = document.querySelector('#audit-message');

function cell(row, value, className = '') {
  const element = document.createElement('td');
  element.textContent = value || '—';
  if (className) element.className = className;
  row.append(element);
}

async function loadAudit() {
  messageElement.textContent = '';
  const response = await fetch('/api/audit');
  if (response.status === 401) return location.assign('/');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not load the audit log.');
  entriesElement.replaceChildren();
  for (const entry of result.entries) {
    const row = document.createElement('tr');
    const date = new Date(entry.at);
    cell(row, Number.isNaN(date.getTime()) ? entry.at : date.toLocaleString(), 'audit-time');
    cell(row, entry.actor);
    cell(row, entry.action, 'audit-action');
    cell(row, entry.detail, 'audit-detail');
    entriesElement.append(row);
  }
  if (!result.entries.length) messageElement.textContent = 'No audit events have been recorded yet.';
}

document.querySelector('#refresh-audit').addEventListener('click', () => {
  loadAudit().catch((error) => { messageElement.textContent = error.message; });
});

loadAudit().catch((error) => { messageElement.textContent = error.message; });
