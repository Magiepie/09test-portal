const logElement = document.querySelector('#server-log');
const statusElement = document.querySelector('#log-status');

function cleanServerLine(line) {
  return line.replace(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}\]:\s*/, '');
}

function isExceptionLine(message) {
  return /(?:^|\s)(?:Exception in thread|Caused by:|Suppressed:|[\w.$]+(?:Exception|Error):|FATAL\b|ERROR\b)/i.test(message)
    || /^\s*at\s+[\w.$/<>]+\([^)]*\)\s*$/.test(message)
    || /^\s*\.\.\.\s+\d+\s+more\s*$/.test(message)
    || /(?:address|port).+already in use/i.test(message)
    || /Process exited \(code=(?!0\b)/i.test(message);
}

function appendLogLine(text) {
  const row = document.createElement('div');
  row.className = 'console-line';
  const separator = text.indexOf('\t');
  const message = cleanServerLine(separator >= 0 ? text.slice(separator + 1) : text);
  const prefix = separator >= 0 ? `${text.slice(0, separator)}\t` : '';
  if (message.includes('[PulseRunner]') || message.includes('[TimerRegistry]')) row.classList.add('console-pulse-runner');
  if (message.includes('[SystemTermination]')
      || message.includes('[SystemShutdownHook]')
      || /\[Server\]\s+2009Scape started in\b/i.test(message)) row.classList.add('console-neutral');
  if (isExceptionLine(message)) row.classList.add('console-exception');
  row.textContent = `${prefix}${message}`;
  logElement.append(row);
}

async function loadLogs() {
  const response = await fetch('/api/logs');
  if (response.status === 401) return location.assign('/');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not load server logs.');
  logElement.replaceChildren();
  if (result.content) {
    for (const line of result.content.split(/\r?\n/)) {
      if (line) appendLogLine(line);
    }
  } else {
    logElement.textContent = 'No server logs have been recorded yet.';
  }
  statusElement.textContent = result.state.server === 'online' ? 'Server online' : result.state.server === 'restart-pending' ? 'Restart pending' : `Server ${result.state.server}`;
  logElement.scrollTop = logElement.scrollHeight;
}

document.querySelector('#refresh-logs').addEventListener('click', () => {
  loadLogs().catch((error) => { logElement.textContent = error.message; });
});

loadLogs().catch((error) => { logElement.textContent = error.message; });
