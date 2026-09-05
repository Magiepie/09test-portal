const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { Server: SocketServer } = require('socket.io');

const portalRoot = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const serverRoot = path.resolve(process.env.SERVER_ROOT || path.join(portalRoot, '..', '2009scape'));
const deployMode = String(process.env.DEPLOY_MODE || 'classic').toLowerCase() === 'mk2' ? 'mk2' : 'classic';
const classicServertoolsRoot = path.resolve(process.env.CLASSIC_SERVERTOOLS_ROOT || path.join(portalRoot, '..', 'servertools-ryan-legacy'));
const mk2ServertoolsRoot = path.resolve(process.env.MK2_SERVERTOOLS_ROOT || path.join(portalRoot, '..', 'servertools'));
const servertoolsRoot = deployMode === 'mk2' ? mk2ServertoolsRoot : classicServertoolsRoot;
const portalPython = isWindows
  ? path.join(portalRoot, '.venv', 'Scripts', 'python.exe')
  : path.join(portalRoot, '.venv', 'bin', 'python3');
const configuredPython = process.env.PYTHON_COMMAND || 'python';
const pythonCommand = configuredPython === 'python' && fs.existsSync(portalPython) ? portalPython : configuredPython;
const dataDir = path.join(portalRoot, 'data');
const auditPath = path.join(dataDir, 'audit.log');
const serverPidPath = path.join(dataDir, 'server.pid');
const portalPidPath = path.join(dataDir, 'portal.pid');
const deployedMrsPath = path.join(dataDir, 'deployed_mrs.json');
const droppedMrsPath = path.join(dataDir, 'dropped_mrs.json');
const manualBranchesPath = path.join(dataDir, 'manual_branches.json');
const serverLogPath = path.join(dataDir, 'server.log');
const port = Number(process.env.PORT || 24247);
const sessionSecret = process.env.SESSION_SECRET || '';
const localPassword = process.env.ADMIN_PASSWORD || '';
const discordConfigured = Boolean(
  process.env.DISCORD_CLIENT_ID &&
  process.env.DISCORD_CLIENT_SECRET &&
  process.env.DISCORD_CALLBACK_URL &&
  process.env.DISCORD_GUILD_ID
);

if (sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters. Copy .env.example to .env and configure it.');
}
if (!localPassword && !discordConfigured) {
  throw new Error('Configure ADMIN_PASSWORD or Discord OAuth before starting 09Test Portal.');
}

fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(portalPidPath, String(process.pid), 'utf8');
process.on('exit', () => {
  try { fs.unlinkSync(portalPidPath); } catch (error) {
    if (error.code !== 'ENOENT') console.error(`Could not remove portal PID file: ${error.message}`);
  }
});

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, { serveClient: true });
const sessionMiddleware = session({
  name: '09test.sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 12 * 60 * 60 * 1000,
  },
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '16kb' }));
app.use(sessionMiddleware);

const consoleBuffer = [];
const MAX_CONSOLE_LINES = 2000;
const MAX_SERVER_LOG_BYTES = 5 * 1024 * 1024;
const partialConsoleLines = new Map();
let serverProcess = null;
let deployProcess = null;
let serverStartedAt = null;
let lastExit = null;
let deployedMrs = [];

function scanDeployedMrs() {
  if (fs.existsSync(deployedMrsPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(deployedMrsPath, 'utf8'));
      if (Array.isArray(manifest)) return manifest;
    } catch (error) {
      console.error(`Could not read deployed MR manifest: ${error.message}`);
    }
  }
  const result = spawnSync('git', ['log', '--first-parent', '--merges', '--format=%s'], {
    cwd: serverRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) return [];
  const seen = new Set();
  const deployed = [];
  for (const subject of result.stdout.split(/\r?\n/)) {
    const match = subject.match(/merge-requests\/(\d+)/i);
    if (!match || seen.has(match[1])) continue;
    seen.add(match[1]);
    deployed.push({
      iid: Number(match[1]),
      url: `https://gitlab.com/2009scape/2009scape/-/merge_requests/${match[1]}`,
    });
  }
  return deployed;
}

function readDroppedMrs() {
  if (!fs.existsSync(droppedMrsPath)) return [];
  const parsed = JSON.parse(fs.readFileSync(droppedMrsPath, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('The dropped MR list is invalid.');
  return [...new Set(parsed.map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
}

function writeDroppedMrs(mrs) {
  fs.writeFileSync(droppedMrsPath, `${JSON.stringify(mrs, null, 2)}\n`, 'utf8');
}

function readManualBranches() {
  if (!fs.existsSync(manualBranchesPath)) return [];
  const parsed = JSON.parse(fs.readFileSync(manualBranchesPath, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('The manually added branch list is invalid.');
  return parsed;
}

function writeManualBranches(branches) {
  fs.writeFileSync(manualBranchesPath, `${JSON.stringify(branches, null, 2)}\n`, 'utf8');
}

function parseGitlabBranchUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || '').trim()); }
  catch { throw new Error('Enter a valid GitLab branch URL.'); }
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'gitlab.com') {
    throw new Error('Only https://gitlab.com branch URLs are supported.');
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  const marker = parts.findIndex((part, index) => part === '-' && parts[index + 1] === 'tree');
  if (marker < 2 || marker + 2 >= parts.length) {
    throw new Error('Use a GitLab URL containing /-/tree/branch-name.');
  }
  const projectPath = parts.slice(0, marker).map(decodeURIComponent).join('/');
  const branch = parts.slice(marker + 2).map(decodeURIComponent).join('/');
  if (!branch || /[\x00-\x1f\x7f]/.test(branch) || branch.includes('..')) {
    throw new Error('That GitLab branch name is not valid.');
  }
  const webUrl = `https://gitlab.com/${projectPath}/-/tree/${branch.split('/').map(encodeURIComponent).join('/')}`;
  return {
    id: crypto.createHash('sha256').update(`${projectPath}\n${branch}`).digest('hex').slice(0, 16),
    projectPath,
    branch,
    webUrl,
    cloneUrl: `https://gitlab.com/${projectPath}.git`,
    deployed: false,
  };
}

deployedMrs = scanDeployedMrs();

function userLabel(req) {
  return req.session.user?.name || req.session.user?.id || 'unknown';
}

function audit(actor, action, detail = '') {
  const line = `${new Date().toISOString()}\t${actor}\t${action}\t${detail}\n`;
  fs.appendFileSync(auditPath, line, 'utf8');
}

function emitConsoleLine(source, line) {
  if (!line) return;
  let cleanLine = line.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
  if (source === 'deploy') cleanLine = cleanLine.replace(/^\d{2}:\d{2}:\d{2}\s+(?=(?:DEBUG|INFO|WARNING|ERROR|CRITICAL)\b)/, '');
  if (source === 'deploy' && cleanLine.startsWith('[maven] ')) {
    source = 'maven';
    cleanLine = cleanLine.slice('[maven] '.length);
  }
  const mavenWarning = source === 'maven' && /^\s*(?:\[WARNING\]|w:)/i.test(cleanLine);
  const importantMavenWarning = /\b(?:exception|error|fatal|fail(?:ed|ure)?)\b/i.test(cleanLine);
  if (mavenWarning && !importantMavenWarning) return;
  const entry = { at: new Date().toISOString(), source, line: cleanLine };
  if (source === 'server') {
    try {
      if (fs.existsSync(serverLogPath) && fs.statSync(serverLogPath).size >= MAX_SERVER_LOG_BYTES) {
        if (fs.existsSync(`${serverLogPath}.previous`)) fs.unlinkSync(`${serverLogPath}.previous`);
        fs.renameSync(serverLogPath, `${serverLogPath}.previous`);
      }
      fs.appendFileSync(serverLogPath, `${entry.at}\t${cleanLine}\n`, 'utf8');
    } catch (error) {
      console.error(`Could not write server log: ${error.message}`);
    }
  }
  consoleBuffer.push(entry);
  if (consoleBuffer.length > MAX_CONSOLE_LINES) consoleBuffer.shift();
  io.to('admins').emit('console-line', entry);
}

function addConsole(source, text, stream = 'combined', flush = true) {
  const key = `${source}:${stream}`;
  const normalized = `${partialConsoleLines.get(key) || ''}${String(text)}`.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const trailing = lines.pop() || '';
  for (const line of lines) {
    emitConsoleLine(source, line);
  }
  if (flush) {
    emitConsoleLine(source, trailing);
    partialConsoleLines.delete(key);
  } else {
    partialConsoleLines.set(key, trailing);
  }
}

function state() {
  return {
    server: serverProcess ? 'online' : 'offline',
    deployment: deployProcess ? 'running' : 'idle',
    startedAt: serverStartedAt,
    lastExit,
    deployedMrs,
    manualBranches: readManualBranches(),
  };
}

function broadcastState() {
  io.to('admins').emit('state', state());
}

function attachProcess(child, source, onExit) {
  child.stdout?.on('data', (chunk) => addConsole(source, chunk, 'stdout', false));
  child.stderr?.on('data', (chunk) => addConsole(source, chunk, 'stderr', false));
  child.on('error', (error) => addConsole(source, `Process error: ${error.message}`));
  child.on('exit', (code, signal) => {
    addConsole(source, '', 'stdout', true);
    addConsole(source, '', 'stderr', true);
    if (source === 'deploy' && code === 0) {
      addConsole(source, 'Current Test deployment completed successfully.');
    } else if (source === 'server' && code === 0) {
      addConsole(source, 'Game server stopped normally.');
    } else {
      addConsole(source, `Process exited (code=${code}, signal=${signal || 'none'}).`);
    }
    onExit(code, signal);
    broadcastState();
  });
}

function javaEnvironment() {
  const lookup = spawnSync(isWindows ? 'where.exe' : 'which', ['java'], { encoding: 'utf8', windowsHide: true });
  if (lookup.status !== 0) throw new Error('Java 11 is required and was not found in PATH.');
  const locatedJava = lookup.stdout.split(/\r?\n/).find(Boolean);
  const javaExecutable = isWindows ? locatedJava : fs.realpathSync(locatedJava);
  const javaHome = path.dirname(path.dirname(javaExecutable));
  const version = spawnSync(javaExecutable, ['-version'], { encoding: 'utf8', windowsHide: true });
  const versionText = `${version.stdout || ''}${version.stderr || ''}`;
  if (!/version "11\./.test(versionText)) throw new Error(`Java 11 is required. Found: ${versionText.split(/\r?\n/)[0]}`);
  return { ...process.env, JAVA_HOME: javaHome };
}

function startServer(actor) {
  if (serverProcess) throw new Error('The server is already running.');
  if (deployProcess) throw new Error('Wait for the MR deployment to finish.');

  const script = path.join(serverRoot, 'run-server.bat');
  if (isWindows && !fs.existsSync(script)) throw new Error(`The server launcher was not found: ${script}`);
  const linuxWrapper = path.join(serverRoot, 'Server', 'mvnw');
  if (!isWindows && !fs.existsSync(linuxWrapper)) throw new Error(`The Maven wrapper was not found: ${linuxWrapper}`);
  fs.appendFileSync(serverLogPath, `\n${new Date().toISOString()}\t===== SERVER START =====\n`, 'utf8');
  const executable = isWindows ? 'cmd.exe' : 'bash';
  const launchArgs = isWindows
    ? ['/d', '/s', '/c', 'call run-server.bat']
    : ['-lc', 'cd Server && ./mvnw package -DskipTests && cp target/*-with-dependencies.jar server.jar && exec java -jar server.jar'];
  serverProcess = spawn(executable, launchArgs, {
    cwd: serverRoot,
    env: javaEnvironment(),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  serverStartedAt = new Date().toISOString();
  lastExit = null;
  fs.writeFileSync(serverPidPath, String(serverProcess.pid), 'utf8');
  audit(actor, 'server.start');
  attachProcess(serverProcess, 'server', (code, signal) => {
    lastExit = { code, signal, at: new Date().toISOString() };
    serverProcess = null;
    serverStartedAt = null;
    try { fs.unlinkSync(serverPidPath); } catch (error) {
      if (error.code !== 'ENOENT') addConsole('portal', `Could not remove stale server PID file: ${error.message}`);
    }
  });
  broadcastState();
}

function stopServer(actor) {
  if (!serverProcess) throw new Error('The server is not running.');
  const pid = serverProcess.pid;
  audit(actor, 'server.stop', `pid=${pid}`);
  if (isWindows) {
    spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    serverProcess.kill('SIGTERM');
  }
}

function deployCurrentTest(actor) {
  if (deployProcess) throw new Error('An MR deployment is already running.');
  if (serverProcess) throw new Error('Stop the server before rebuilding the MR stack.');

  const script = path.join(portalRoot, 'scripts', 'deploy_current_test.py');
  deployProcess = spawn(pythonCommand, [
    script,
    '--server-root', serverRoot,
    '--servertools-root', servertoolsRoot,
    '--manifest', deployedMrsPath,
    '--exclusions', droppedMrsPath,
    '--mode', deployMode,
    '--manual-branches', manualBranchesPath,
  ], {
    cwd: serverRoot,
    env: javaEnvironment(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  audit(actor, 'deployment.start');
  attachProcess(deployProcess, 'deploy', (code) => {
    audit('system', 'deployment.exit', `code=${code}`);
    deployProcess = null;
    if (code === 0) deployedMrs = scanDeployedMrs();
  });
  broadcastState();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Authentication required.' });
  next();
}

function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

app.use('/assets', express.static(path.join(portalRoot, 'public'), { index: false }));

app.get('/', (req, res) => {
  if (!req.session.user) return res.sendFile(path.join(portalRoot, 'public', 'login.html'));
  res.sendFile(path.join(portalRoot, 'public', 'index.html'));
});

app.get('/logs', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  res.sendFile(path.join(portalRoot, 'public', 'logs.html'));
});

app.post('/auth/local', (req, res) => {
  if (!localPassword || !safeEqual(req.body.password || '', localPassword)) {
    audit(req.ip, 'auth.local.denied');
    return res.status(403).send('Invalid credentials.');
  }
  req.session.user = { id: 'local-admin', name: 'Local administrator', provider: 'local' };
  audit('local-admin', 'auth.local.success');
  res.redirect('/');
});

app.get('/auth/discord', (req, res) => {
  if (!discordConfigured) return res.status(503).send('Discord login is not configured.');
  const stateToken = crypto.randomBytes(24).toString('hex');
  req.session.discordState = stateToken;
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_CALLBACK_URL,
    response_type: 'code',
    scope: 'identify guilds.members.read',
    state: stateToken,
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  try {
    if (!req.query.state || !safeEqual(req.query.state, req.session.discordState || '')) {
      return res.status(403).send('Invalid OAuth state.');
    }
    delete req.session.discordState;
    const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(req.query.code || ''),
        redirect_uri: process.env.DISCORD_CALLBACK_URL,
      }),
    });
    if (!tokenResponse.ok) throw new Error(`Discord token exchange failed (${tokenResponse.status}).`);
    const token = await tokenResponse.json();
    const authHeaders = { authorization: `Bearer ${token.access_token}` };
    const [userResponse, memberResponse] = await Promise.all([
      fetch('https://discord.com/api/v10/users/@me', { headers: authHeaders }),
      fetch(`https://discord.com/api/v10/users/@me/guilds/${process.env.DISCORD_GUILD_ID}/member`, { headers: authHeaders }),
    ]);
    if (!userResponse.ok || !memberResponse.ok) return res.status(403).send('You are not a member of the configured Discord server.');
    const user = await userResponse.json();
    const member = await memberResponse.json();
    const requiredRoles = (process.env.DISCORD_ADMIN_ROLE_IDS || '').split(',').map((v) => v.trim()).filter(Boolean);
    if (requiredRoles.length && !member.roles.some((role) => requiredRoles.includes(role))) {
      audit(user.id, 'auth.discord.role_denied');
      return res.status(403).send('Your Discord account does not have an administrator role.');
    }
    req.session.user = {
      id: user.id,
      name: user.global_name || user.username,
      avatar: user.avatar,
      provider: 'discord',
    };
    audit(user.id, 'auth.discord.success');
    res.redirect('/');
  } catch (error) {
    addConsole('portal', error.stack || error.message);
    res.status(502).send('Discord authentication failed.');
  }
});

app.post('/auth/logout', (req, res) => {
  const actor = userLabel(req);
  req.session.destroy(() => {
    audit(actor, 'auth.logout');
    res.redirect('/');
  });
});

app.get('/api/bootstrap', requireAdmin, (req, res) => {
  res.json({ user: req.session.user, state: state(), console: consoleBuffer });
});

app.get('/api/logs', requireAdmin, (req, res) => {
  let content = '';
  try {
    if (fs.existsSync(serverLogPath)) content = fs.readFileSync(serverLogPath, 'utf8');
  } catch (error) {
    return res.status(500).json({ error: `Could not read server logs: ${error.message}` });
  }
  res.json({ content, state: state() });
});

app.post('/api/server/start', requireAdmin, (req, res) => {
  try { startServer(userLabel(req)); res.status(202).json(state()); }
  catch (error) { res.status(409).json({ error: error.message }); }
});

app.post('/api/server/stop', requireAdmin, (req, res) => {
  try { stopServer(userLabel(req)); res.status(202).json(state()); }
  catch (error) { res.status(409).json({ error: error.message }); }
});

app.post('/api/deployment/run', requireAdmin, (req, res) => {
  try { deployCurrentTest(userLabel(req)); res.status(202).json(state()); }
  catch (error) { res.status(409).json({ error: error.message }); }
});

app.post('/api/mrs/:iid/toggle', requireAdmin, (req, res) => {
  try {
    if (deployProcess) throw new Error('Wait for the current MR deployment to finish.');
    if (serverProcess) throw new Error('Stop the server before changing the MR stack.');
    const iid = Number(req.params.iid);
    const mr = deployedMrs.find((item) => Number(item.iid) === iid);
    if (!Number.isInteger(iid) || !mr) return res.status(404).json({ error: 'That MR is not in the current stack.' });
    const dropped = new Set(readDroppedMrs());
    if (typeof req.body.dropped !== 'boolean') return res.status(400).json({ error: 'A dropped state is required.' });
    const shouldDrop = req.body.dropped;
    if (shouldDrop) dropped.add(iid); else dropped.delete(iid);
    writeDroppedMrs([...dropped].sort((a, b) => a - b));
    mr.dropped = shouldDrop;
    audit(userLabel(req), shouldDrop ? 'mr.drop' : 'mr.add', `!${iid}`);
    addConsole('portal', `${shouldDrop ? 'Dropping' : 'Adding'} MR !${iid}; rebuilding Current Test...`);
    deployCurrentTest(userLabel(req));
    res.status(202).json(state());
  } catch (error) {
    res.status(409).json({ error: error.message });
  }
});

app.post('/api/branches', requireAdmin, (req, res) => {
  try {
    if (deployProcess) throw new Error('Wait for the current MR deployment to finish.');
    if (serverProcess) throw new Error('Stop the server before changing the branch stack.');
    const branch = parseGitlabBranchUrl(req.body.url);
    const branches = readManualBranches();
    if (branches.some((item) => item.id === branch.id)) {
      return res.status(409).json({ error: 'That branch is already in the Active Stack.' });
    }
    branches.push(branch);
    writeManualBranches(branches);
    audit(userLabel(req), 'branch.add', `${branch.projectPath}:${branch.branch}`);
    addConsole('portal', `Adding branch ${branch.branch}; rebuilding Current Test...`);
    deployCurrentTest(userLabel(req));
    res.status(202).json(state());
  } catch (error) {
    res.status(409).json({ error: error.message });
  }
});

app.delete('/api/branches/:id', requireAdmin, (req, res) => {
  try {
    if (deployProcess) throw new Error('Wait for the current MR deployment to finish.');
    if (serverProcess) throw new Error('Stop the server before changing the branch stack.');
    const branches = readManualBranches();
    const branch = branches.find((item) => item.id === req.params.id);
    if (!branch) return res.status(404).json({ error: 'That branch is not in the Active Stack.' });
    writeManualBranches(branches.filter((item) => item.id !== branch.id));
    audit(userLabel(req), 'branch.remove', `${branch.projectPath}:${branch.branch}`);
    addConsole('portal', `Removing branch ${branch.branch}; rebuilding Current Test...`);
    deployCurrentTest(userLabel(req));
    res.status(202).json(state());
  } catch (error) {
    res.status(409).json({ error: error.message });
  }
});

app.post('/api/console', requireAdmin, (req, res) => {
  const command = String(req.body.command || '').trim();
  if (!serverProcess || !serverProcess.stdin?.writable) return res.status(409).json({ error: 'Server console is unavailable.' });
  if (!command || command.length > 300) return res.status(400).json({ error: 'Enter a command of 1–300 characters.' });
  serverProcess.stdin.write(`${command}\r\n`);
  addConsole('admin', `> ${command}`);
  audit(userLabel(req), 'console.command', command);
  res.status(202).json({ ok: true });
});

io.engine.use(sessionMiddleware);
io.on('connection', (socket) => {
  if (!socket.request.session?.user) return socket.disconnect(true);
  socket.join('admins');
  socket.emit('state', state());
});

server.listen(port, '127.0.0.1', () => {
  console.log(`09Test Portal: http://localhost:${port}`);
});
