const consoleElement = document.querySelector('#console');
const messageElement = document.querySelector('#action-message');
let currentState = null;

function restartCountdown(state) {
  if (state?.server !== 'restart-pending' || !state.scheduledRestartAt) return null;
  const seconds = Math.max(0, Math.ceil((new Date(state.scheduledRestartAt).getTime() - Date.now()) / 1000));
  if (seconds === 0) return '00:00';
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function refreshRestartCountdown() {
  const remaining = restartCountdown(currentState);
  if (remaining === null) return;
  document.querySelector('#server-status').textContent = `Restart Pending · ${remaining}`;
}

function isExceptionLine(message) {
  return /(?:^|\s)(?:Exception in thread|Caused by:|Suppressed:|[\w.$]+(?:Exception|Error):|FATAL\b|ERROR\b)/i.test(message)
    || /^\s*at\s+[\w.$/<>]+\([^)]*\)\s*$/.test(message)
    || /^\s*\.\.\.\s+\d+\s+more\s*$/.test(message)
    || /(?:address|port).+already in use/i.test(message)
    || /Process exited \(code=(?!0\b)/i.test(message);
}

function gitlabLabelColor(label) {
  const colors = {
    'Status::Needs Testing': '#fc9403',
    'Status::Ready To Merge': '#1f9d55',
    'Status::Needs Review': '#1f75cb',
    'Status::Changes Required': '#dd2b0e',
    'Status::Merge Conflict': '#dd2b0e',
    'Status::Awaiting Dependency': '#a86e00',
    'Status::Work in Progress': '#6b7280',
    'Status::Abandoned': '#6b7280',
    'Test Priority::Update Blocker': '#dc143c',
  };
  return colors[label] || '#59636e';
}

function createGitlabLabel(label) {
  const badge = document.createElement('span');
  badge.className = 'gitlab-label';
  badge.style.setProperty('--label-color', gitlabLabelColor(label));
  const parts = label.split('::');
  if (parts.length > 1) {
    const scope = document.createElement('span');
    scope.className = 'gitlab-label-scope';
    scope.textContent = parts.shift();
    const value = document.createElement('span');
    value.className = 'gitlab-label-value';
    value.textContent = parts.join('::');
    badge.append(scope, value);
  } else {
    badge.classList.add('gitlab-label-unscoped');
    badge.textContent = label;
  }
  return badge;
}

function createManualBranchCard(branch) {
  const item = document.createElement('div');
  item.className = `mr-item manual-branch${branch.deployed === false ? ' branch-pending' : ''}`;
  const link = document.createElement('a');
  link.className = 'mr-link';
  link.href = branch.webUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = `${branch.projectPath}\nLocal state: ${branch.deployed === false ? 'Waiting for successful rebuild' : 'Deployed'}`;
  const content = document.createElement('span');
  content.className = 'mr-link-content';
  const name = document.createElement('strong');
  name.textContent = branch.branch;
  const tag = document.createElement('span');
  tag.className = 'manual-tag';
  tag.textContent = 'Manually Added';
  content.append(name, tag);
  link.append(content);

  const actions = document.createElement('span');
  actions.className = 'mr-item-actions';
  const arrow = document.createElement('a');
  arrow.className = 'mr-arrow';
  arrow.href = branch.webUrl;
  arrow.target = '_blank';
  arrow.rel = 'noopener noreferrer';
  arrow.textContent = '↗';
  arrow.setAttribute('aria-label', `Open branch ${branch.branch} on GitLab`);
  const remove = document.createElement('button');
  remove.className = 'mr-toggle';
  remove.type = 'button';
  remove.textContent = 'Remove';
  remove.disabled = currentState?.deployment === 'running' || currentState?.server === 'online';
  remove.addEventListener('click', async () => {
    if (!window.confirm(`Remove branch ${branch.branch} and rebuild Current Test?`)) return;
    try { await action(`/api/branches/${branch.id}`, undefined, 'DELETE'); }
    catch (error) { messageElement.textContent = error.message; }
  });
  actions.append(arrow, remove);
  item.append(link, actions);
  return item;
}

function renderMrs(mrs = [], manualBranches = []) {
  const list = document.querySelector('#mr-list');
  document.querySelector('#mr-count').textContent = String(mrs.length + manualBranches.length);
  list.replaceChildren();
  if (!mrs.length && !manualBranches.length) {
    const empty = document.createElement('p');
    empty.className = 'mr-empty';
    empty.textContent = 'No merge requests are deployed on the current branch.';
    list.append(empty);
    return;
  }
  for (const branch of manualBranches) list.append(createManualBranchCard(branch));
  const statusOrder = (mr) => {
    const labels = Array.isArray(mr.labels) ? mr.labels : [];
    if (labels.includes('Status::Ready To Merge')) return 2;
    if (labels.includes('Status::Needs Review')) return 1;
    return 0;
  };
  const orderedMrs = mrs
    .map((mr, index) => ({ mr, index }))
    .sort((left, right) => statusOrder(left.mr) - statusOrder(right.mr) || left.index - right.index)
    .map(({ mr }) => mr);
  for (const mr of orderedMrs) {
    const item = document.createElement('div');
    item.className = `mr-item${mr.dropped ? ' dropped' : ''}`;
    const link = document.createElement('a');
    link.className = 'mr-link';
    link.href = mr.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const metadata = [
      mr.title || 'No title available',
      `Opened by: ${mr.author || 'Unknown'}`,
      `Local state: ${mr.dropped ? 'Dropped' : 'Deployed'}`,
    ];
    link.title = metadata.join('\n');
    const content = document.createElement('span');
    content.className = 'mr-link-content';
    const number = document.createElement('strong');
    number.textContent = `!${mr.iid}`;
    content.append(number);
    if (Array.isArray(mr.labels) && mr.labels.length) {
      const labels = document.createElement('span');
      labels.className = 'mr-labels';
      for (const label of mr.labels) {
        labels.append(createGitlabLabel(label));
      }
      content.append(labels);
    }
    const actions = document.createElement('span');
    actions.className = 'mr-item-actions';
    const arrow = document.createElement('a');
    arrow.className = 'mr-arrow';
    arrow.href = mr.url;
    arrow.target = '_blank';
    arrow.rel = 'noopener noreferrer';
    arrow.textContent = '↗';
    arrow.setAttribute('aria-label', `Open merge request ${mr.iid} on GitLab`);
    link.append(content);
    link.setAttribute('aria-label', `Open merge request ${mr.iid} on GitLab`);
    const toggle = document.createElement('button');
    toggle.className = `mr-toggle${mr.dropped ? ' add' : ''}`;
    toggle.type = 'button';
    toggle.textContent = mr.dropped ? 'Add MR' : 'Drop MR';
    toggle.disabled = currentState?.deployment === 'running' || currentState?.server === 'online';
    toggle.addEventListener('click', async () => {
      const verb = mr.dropped ? 'add' : 'drop';
      if (!window.confirm(`${verb === 'drop' ? 'Drop' : 'Add'} MR !${mr.iid} and rebuild Current Test?`)) return;
      try {
        await action(`/api/mrs/${mr.iid}/toggle`, { dropped: !mr.dropped });
      } catch (error) {
        messageElement.textContent = error.message;
      }
    });
    actions.append(arrow, toggle);
    item.append(link, actions);
    list.append(item);
  }
}

function appendLine(entry) {
  const row = document.createElement('div');
  row.className = `console-line source-${entry.source}`;
  const time = new Date(entry.at).toLocaleTimeString([], { hour12: false });
  let message = entry.line;
  let source = `[${entry.source}]  `;
  if (entry.source === 'deploy') {
    message = message.replace(/^\d{2}:\d{2}:\d{2}\s+(?=(?:DEBUG|INFO|WARNING|ERROR|CRITICAL)\b)/, '');
    if (message.startsWith('[maven] ')) {
      message = message.slice('[maven] '.length);
      source = '[maven]  ';
    }
  }
  const mavenLine = entry.source === 'maven' || source === '[maven]  ';
  const mavenWarning = mavenLine && /^\s*(?:\[WARNING\]|w:)/i.test(message);
  const importantMavenWarning = /\b(?:exception|error|fatal|fail(?:ed|ure)?)\b/i.test(message);
  if (mavenWarning && !importantMavenWarning) return;
  if (entry.source === 'server') {
    message = message.replace(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{4})\]:\s*/, '');
    source = '';
  }
  if (message.includes('[PulseRunner]') || message.includes('[TimerRegistry]')) row.classList.add('console-pulse-runner');
  if (message.includes('[SystemTermination]')
      || message.includes('[SystemShutdownHook]')
      || /\[Server\]\s+2009Scape started in\b/i.test(message)) row.classList.add('console-neutral');
  if (isExceptionLine(message)) row.classList.add('console-exception');
  row.textContent = `${time}  ${source}${message}`;
  consoleElement.append(row);
  while (consoleElement.children.length > 2000) consoleElement.firstChild.remove();
  consoleElement.scrollTop = consoleElement.scrollHeight;
}

function renderState(state) {
  currentState = state;
  const online = state.server === 'online';
  const serverBusy = ['compiling', 'starting', 'stopping', 'restart-pending'].includes(state.server);
  const deploying = state.deployment !== 'idle';
  const labels = { offline: 'Offline', deploying: 'Deploying', compiling: 'Compiling', starting: 'Starting', online: 'Online', stopping: 'Stopping', 'restart-pending': 'Restart Pending' };
  document.querySelector('#server-status').textContent = labels[state.server] || 'Offline';
  const statusDot = document.querySelector('#status-dot');
  statusDot.className = `status-dot ${state.server || 'offline'}`;
  document.querySelector('#deploy-button').disabled = deploying || online || serverBusy;
  document.querySelector('#rebuild-button').disabled = deploying || !['online', 'offline'].includes(state.server);
  document.querySelector('#run-all-button').disabled = deploying || !['online', 'offline'].includes(state.server);
  const toggleButton = document.querySelector('#server-toggle-button');
  const canStop = ['online', 'compiling', 'starting', 'restart-pending'].includes(state.server);
  toggleButton.textContent = state.server === 'stopping' ? 'Stopping…' : canStop ? 'Stop server' : 'Start server';
  toggleButton.classList.toggle('danger', canStop || state.server === 'stopping');
  toggleButton.classList.toggle('secondary', !canStop && state.server !== 'stopping');
  toggleButton.disabled = deploying || state.server === 'stopping';
  document.querySelector('#command').disabled = !online && state.server !== 'restart-pending';
  document.querySelector('#branch-url').disabled = deploying || online || serverBusy;
  document.querySelector('#branch-form button').disabled = deploying || online || serverBusy;
  renderMrs(state.deployedMrs, state.manualBranches);
  refreshRestartCountdown();
}

setInterval(refreshRestartCountdown, 1000);

async function action(url, body, method = 'POST') {
  messageElement.textContent = '';
  const response = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (response.status === 404) {
      throw new Error('This action is not available in the running portal. Restart 09Test Portal and try again.');
    }
    throw new Error(`Portal request failed (HTTP ${response.status}).`);
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Action failed.');
  if (result.server) renderState(result);
}

document.querySelector('#deploy-button').addEventListener('click', () => action('/api/deployment/run').catch((e) => { messageElement.textContent = e.message; }));
document.querySelector('#rebuild-button').addEventListener('click', () => action('/api/server/rebuild').catch((e) => { messageElement.textContent = e.message; }));
document.querySelector('#run-all-button').addEventListener('click', () => {
  if (!window.confirm('Run the full update workflow? An online server will receive a five-minute update countdown first.')) return;
  action('/api/server/run-all').catch((e) => { messageElement.textContent = e.message; });
});
document.querySelector('#server-toggle-button').addEventListener('click', () => {
  const shouldStop = ['online', 'compiling', 'starting', 'restart-pending'].includes(currentState?.server);
  action(shouldStop ? '/api/server/stop' : '/api/server/start').catch((e) => { messageElement.textContent = e.message; });
});
document.querySelector('#branch-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.querySelector('#branch-url');
  try {
    await action('/api/branches', { url: input.value });
    input.value = '';
  } catch (error) {
    messageElement.textContent = error.message;
  }
});
document.querySelector('#command-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.querySelector('#command');
  try { await action('/api/console', { command: input.value }); input.value = ''; }
  catch (error) { messageElement.textContent = error.message; }
});

fetch('/api/bootstrap').then((response) => {
  if (response.status === 401) return location.reload();
  return response.json();
}).then((data) => {
  if (!data) return;
  document.querySelector('#account-name').textContent = data.user.name;
  data.console.forEach(appendLine);
  renderState(data.state);
});

const socket = io();
socket.on('console-line', appendLine);
socket.on('state', renderState);
