const editor = document.querySelector('#config-editor');
const highlight = document.querySelector('#config-highlight');
const message = document.querySelector('#config-message');
const saveButton = document.querySelector('#save-config');
let savedContent = '';

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightLine(line) {
  const commentAt = line.search(/(?<!:)\/\/|#/);
  const code = commentAt >= 0 ? line.slice(0, commentAt) : line;
  const comment = commentAt >= 0 ? line.slice(commentAt) : '';
  let html = escapeHtml(code);
  html = html.replace(/(&quot;.*?&quot;|'.*?')/g, '<span class="conf-string">$1</span>');
  html = html.replace(/\b(true|false|null)\b/gi, '<span class="conf-boolean">$1</span>');
  html = html.replace(/\b(-?\d+(?:\.\d+)?)\b/g, '<span class="conf-number">$1</span>');
  html = html.replace(/^([ \t]*)([A-Za-z_][\w.-]*)(?=\s*[=:])/g, '$1<span class="conf-key">$2</span>');
  return `${html}${comment ? `<span class="conf-comment">${escapeHtml(comment)}</span>` : ''}`;
}

function renderHighlight() {
  highlight.innerHTML = `${editor.value.split('\n').map(highlightLine).join('\n')}\n`;
}

function syncScroll() {
  highlight.scrollTop = editor.scrollTop;
  highlight.scrollLeft = editor.scrollLeft;
}

async function loadConfig() {
  const response = await fetch('/api/world-config');
  if (response.status === 401 || response.status === 403) return location.assign('/');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not load default.conf.');
  savedContent = result.content;
  editor.value = result.content;
  document.querySelector('#config-path').textContent = result.path;
  if (result.serverRunning) message.textContent = 'The game server is running. Saved changes require a restart.';
  renderHighlight();
}

editor.addEventListener('input', renderHighlight);
editor.addEventListener('scroll', syncScroll);
editor.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  event.preventDefault();
  const start = editor.selectionStart;
  editor.setRangeText('  ', start, editor.selectionEnd, 'end');
  renderHighlight();
});

saveButton.addEventListener('click', async () => {
  if (editor.value === savedContent) {
    message.textContent = 'No changes to save.';
    return;
  }
  if (!window.confirm('Save changes to Server/worldprops/default.conf?')) return;
  saveButton.disabled = true;
  message.textContent = 'Saving…';
  try {
    const response = await fetch('/api/world-config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: editor.value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not save default.conf.');
    savedContent = editor.value;
    message.textContent = result.serverRunning
      ? 'Saved. Restart the game server to apply these changes.'
      : 'Saved. The next server start will use these changes.';
  } catch (error) {
    message.textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
});

window.addEventListener('beforeunload', (event) => {
  if (editor.value === savedContent) return;
  event.preventDefault();
  event.returnValue = '';
});

loadConfig().catch((error) => { message.textContent = error.message; saveButton.disabled = true; });
