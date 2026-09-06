const form = document.querySelector('#settings-form');
const message = document.querySelector('#settings-message');
let canEdit = false;

function applyAccess() {
  for (const control of form.querySelectorAll('input, select, button')) control.disabled = !canEdit;
  document.querySelector('#settings-access').textContent = canEdit ? 'Local administrator' : 'View only';
  document.querySelector('#settings-note').textContent = canEdit
    ? 'Changes are saved locally on this server.'
    : 'Sign in with the local administrator password to change these settings.';
}

async function loadSettings() {
  const response = await fetch('/api/settings');
  if (response.status === 401) return location.assign('/');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not load settings.');
  canEdit = result.canEdit;
  document.querySelector('#deploy-mode').value = result.settings.deployMode;
  document.querySelector('#daily-enabled').checked = result.settings.dailyRedeployEnabled;
  document.querySelector('#daily-time').value = result.settings.dailyRedeployTime;
  document.querySelector('#interval-hours').value = result.settings.redeployIntervalHours || 4;
  document.querySelector('#last-run').textContent = result.settings.nextScheduledAt
    ? `Next scheduled start: ${new Date(result.settings.nextScheduledAt).toLocaleString()}`
    : 'Automatic redeployment is not scheduled.';
  applyAccess();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';
  const response = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deployMode: document.querySelector('#deploy-mode').value,
      dailyRedeployEnabled: document.querySelector('#daily-enabled').checked,
      dailyRedeployTime: document.querySelector('#daily-time').value,
      redeployIntervalHours: Number(document.querySelector('#interval-hours').value),
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not save settings.');
  document.querySelector('#last-run').textContent = result.settings.nextScheduledAt
    ? `Next scheduled start: ${new Date(result.settings.nextScheduledAt).toLocaleString()}`
    : 'Automatic redeployment is not scheduled.';
  message.textContent = 'Settings saved.';
});

document.querySelector('#run-schedule-now').addEventListener('click', async () => {
  message.textContent = '';
  if (!window.confirm('Stop the server, redeploy, clean compile, and restart now?')) return;
  const response = await fetch('/api/settings/redeploy-now', { method: 'POST' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not start the redeploy.');
  message.textContent = 'Redeploy and restart started. Return to the portal to watch progress.';
});

window.addEventListener('unhandledrejection', (event) => {
  message.textContent = event.reason?.message || 'Settings request failed.';
});

loadSettings().catch((error) => { message.textContent = error.message; });
