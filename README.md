# 09Test Portal

09Test Portal is an authenticated control panel for 2009Scape Test server, an administrator can:

- Build the current merge-request stack in "classic mode" or with real_damighty's deeper checks.
- See which MRs are deployed and open them on GitLab.
- Compile, start, and stop the 2009Scape server.
- Watch the deployment and game-server console live.
- Open a persistent server log page for reviewing exceptions after a crash or exit.
- Temporarily drop or re-add individual MRs and automatically rebuild the local stack for debugging.
- Add a GitLab fork branch by its `/-/tree/branch-name` URL and merge it after the normal MR stack for local testing.
- Sign in with a local emergency password or an approved Discord role.
- Review administrative actions in `data/audit.log`.

The portal, game server, and MR bot are separate Git projects. The portal does not modify upstream GitLab labels or comments.

09Test Portal supports two deployment modes: **classic** and **mk2**. The selected servertools project decides which MRs belong on the test server and performs the merges.

The portal then adds its own local features around that deployer:

- Retry when GitLab temporarily goes offline.
- Prevent the local test portal from changing GitLab labels or comments.
- Drop and restore individual MRs for debugging.
- Add a branch that is not part of the normal MR queue.
- Save MR names, authors, labels, and links for the Active Stack display.
- Recover from an unfinished merge left by an interrupted deployment.

These additions live inside 09Test Portal. The downloaded servertools projects remain unchanged, which makes them easier to update later.

Only add branches from people you trust. A manually added branch becomes executable server code when the stack is compiled and started.

## Before you begin

Use Windows 10 or 11 and install:

1. [Git for Windows](https://git-scm.com/download/win), including Git LFS.
2. [Node.js](https://nodejs.org/) version 20 or newer.
3. [Python](https://www.python.org/downloads/) version 3.
4. [Eclipse Temurin Java 11](https://adoptium.net/temurin/releases/?version=11).

During Python installation, enable **Add Python to PATH**. Restart Windows after installing the prerequisites if commands are not recognized.

## Step 1: Clone the projects

Open PowerShell and create a folder for the projects:

```powershell
New-Item -ItemType Directory -Force C:\Servers
```

Clone the 2009Scape server and download its Git LFS files:

```powershell
git clone https://gitlab.com/2009scape/2009scape.git C:\Servers\2009scape
git -C C:\Servers\2009scape lfs pull
```

Optional: only clone real_damighty's server tools if you plan to use `DEPLOY_MODE=mk2`:

```powershell
git clone --branch mk2 https://gitlab.com/real_damighty/2009servertools.git C:\Servers\2009servertools
```

Clone the classic server tools used by the default deployment mode:

```powershell
git clone https://gitlab.com/ryannathans/2009servertools.git C:\Servers\2009servertools-classic
```

Clone 09Test Portal, replacing the example URL with this project's Git URL:

```powershell
git clone YOUR_09TEST_PORTAL_REPOSITORY_URL C:\Servers\09test-portal
```

Use a dedicated 2009Scape checkout. **Get Test Deploys** recreates its `local-current-test` branch from `origin/master`; do not use a checkout containing uncommitted work you need to keep.

## Step 2: Start 09Test Portal

Open `C:\Servers\09test-portal` in File Explorer and double-click:

```text
run-portal.bat
```

On the first run, the setup asks for:

1. The 2009Scape checkout. The example is `C:\Servers\2009scape`.
2. The classic servertools checkout.
3. An optional real_damighty `mk2` checkout. Leave it blank when using classic mode only.
4. A local emergency administrator password of at least 12 characters.

The launcher then:

- Generates a private session secret.
- Creates `.env`, which is excluded from Git.
- Creates an isolated Python environment.
- Installs the required Node and Python packages.
- Starts the portal and opens `http://localhost:24247`.

Sign in with the emergency password until Discord access is configured.

## Step 3: Build and run Current Test

After signing in:

1. Select **Get Test Deploys**.
2. Watch the console while the bot fetches and merges eligible MRs.
3. Wait for **Current Test deployment completed successfully**.
4. Review the **Deployed MRs** list. Selecting an MR opens the original GitLab page.
5. Select **Start server**.
6. Wait for Maven to finish compiling and for **TEST SERVER** to show **Online**.

The first build takes longer because Maven must download dependencies and compile everything. Temporary GitLab connection failures are retried automatically.

Use **Stop server** to stop only the game server. Double-click `stop_server.bat` to stop both the game server and the 09Test Portal website.

## Untested Linux setup

> **Experimental and currently untested:** the primary supported setup is Windows. The portal includes Linux launch and stop scripts, but paths, Java packaging, and service behavior can vary between distributions.

Install these prerequisites using your distribution's package manager or their official installers:

- Git and Git LFS
- Node.js 20 or newer and npm
- Python 3 with virtual-environment support
- Java 11 JDK
- Bash

Clone the server, classic servertools, and portal repositories. The mk2 clone is optional. The following layout is only an example:

```bash
mkdir -p ~/09test
git clone https://gitlab.com/2009scape/2009scape.git ~/09test/2009scape
git -C ~/09test/2009scape lfs pull
git clone https://gitlab.com/ryannathans/2009servertools.git ~/09test/servertools-classic
# Optional, only for DEPLOY_MODE=mk2:
git clone --branch mk2 https://gitlab.com/real_damighty/2009servertools.git ~/09test/servertools-mk2
git clone YOUR_09TEST_PORTAL_REPOSITORY_URL ~/09test/09test-portal
```

Create the portal configuration:

```bash
cd ~/09test/09test-portal
cp .env.example .env
```

Edit `.env` with Linux paths and a private password:

```dotenv
PORT=24247
DEPLOY_MODE=classic
SERVER_ROOT=/home/yourname/09test/2009scape
CLASSIC_SERVERTOOLS_ROOT=/home/yourname/09test/servertools-classic
MK2_SERVERTOOLS_ROOT=
PYTHON_COMMAND=python3
ADMIN_PASSWORD=replace-with-a-long-unique-password
```

Keep the generated or configured `SESSION_SECRET` at least 32 characters long. If Discord login is enabled, use this callback unless the portal is exposed through a different hostname:

```dotenv
DISCORD_CALLBACK_URL=http://localhost:24247/auth/discord/callback
```

Make the scripts and Maven wrapper executable, then launch:

```bash
chmod +x run-portal.sh stop-server.sh ~/09test/2009scape/Server/mvnw
./run-portal.sh
```

Open `http://localhost:24247` in a browser. To stop the game server and portal:

```bash
./stop-server.sh
```

On Linux, **Start Server** runs `Server/mvnw package -DskipTests`, copies the dependencies JAR to `Server/server.jar`, and starts it with Java 11. Report distribution-specific failures with the portal console output and the contents of `data/server.log`.

## Add a branch outside the test MR queue

Paste a GitLab branch page URL into the field at the top of **Active Stack**, then select **Add**. For example:

```text
https://gitlab.com/Magiepie1/2009-scape-server/-/tree/instanceCollisionfix
```

The portal rebuilds the normal MR stack first and merges the manually added branch last. Its card uses the branch name and a **Manually Added** tag. Use **Remove** to take it out and rebuild. Only add branches from people you trust because their code is compiled and executed by the local server.

## Step 4: Configure Discord access

Discord access uses OAuth2 to identify the user, verify membership in one Discord server, and optionally require an administrator role.

### Create a Discord application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Select **New Application**.
3. Name it `09Test Portal` and create it.
4. Open **OAuth2** in the application's left sidebar.
5. Under **Redirects**, select **Add Redirect**.
6. Enter this exact address:

   ```text
   http://localhost:24247/auth/discord/callback
   ```

7. Select **Save Changes**.
8. Copy the application's **Client ID**.
9. Copy or reset the **Client Secret**. Treat this secret like a password.

The redirect address must match exactly, including `http`, port `24247`, and the callback path. A Discord bot does not need to be added to the server for this login flow.

### Find the Discord server and role IDs

1. In Discord, open **User Settings**.
2. Select **Advanced**.
3. Enable **Developer Mode**.
4. Right-click the Discord server icon and select **Copy Server ID**.
5. Open **Server Settings → Roles**.
6. Right-click the role that should access 09Test Portal and select **Copy Role ID**.

Repeat the last step if multiple roles should have access.

### Add the Discord settings

Open the portal's `.env` file in a text editor and fill in:

```dotenv
DISCORD_CLIENT_ID=your-client-id
DISCORD_CLIENT_SECRET=your-client-secret
DISCORD_CALLBACK_URL=http://localhost:24247/auth/discord/callback
DISCORD_GUILD_ID=your-server-id
DISCORD_ADMIN_ROLE_IDS=your-admin-role-id
```

Separate multiple allowed role IDs with commas:

```dotenv
DISCORD_ADMIN_ROLE_IDS=role-id-one,role-id-two,role-id-three
```

If `DISCORD_ADMIN_ROLE_IDS` is blank, every member of the configured Discord server can sign in. Add at least one role ID when the portal should be restricted to administrators.

Restart the portal after changing `.env`:

1. Double-click `stop_server.bat`.
2. Double-click `run-portal.bat`.
3. Select **Continue with Discord** on the login page.
4. Authorize the application.

Users outside the configured server, or without an allowed role, receive an access-denied response.

## Manual configuration

The one-click launcher is recommended. To configure the portal manually:

```powershell
cd C:\Servers\09test-portal
Copy-Item .env.example .env
npm install
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install "requests~=2.32.3"
```

Edit `.env` and set at least:

```dotenv
SERVER_ROOT=C:\Servers\2009scape
DEPLOY_MODE=classic
CLASSIC_SERVERTOOLS_ROOT=C:\Servers\2009servertools-classic
MK2_SERVERTOOLS_ROOT=
SESSION_SECRET=use-a-random-secret-of-at-least-32-characters
ADMIN_PASSWORD=use-a-long-unique-emergency-password
```

`DEPLOY_MODE=classic` uses the quicker merge workflow that the portal used before mk2 was added and does not require Damighty's checkout. To use dependency scans, overlap analysis, compilation checks, and failure isolation, clone Damighty's `mk2` branch, set `MK2_SERVERTOOLS_ROOT` to that folder, and change the mode to `DEPLOY_MODE=mk2`. Restart the portal after changing this setting.

Start the portal with:

```powershell
npm start
```

## Troubleshooting

### The portal does not open

- Confirm the launcher window says `09Test Portal: http://localhost:24247`.
- Confirm Node.js is installed with `node --version`.
- Stop an older portal instance with `stop_server.bat`, then start it again.

### Java or Maven does not start

- Confirm `java -version` reports Java 11.
- Confirm `SERVER_ROOT` points to the folder containing `run-server.bat` and the `Server` directory.

### The MR bot reports that `requests` is missing

Close the portal and run `run-portal.bat` again. The launcher creates `.venv` and installs `requests` automatically.

### Discord reports an invalid redirect

Confirm both the Discord Developer Portal and `.env` contain exactly:

```text
http://localhost:24247/auth/discord/callback
```

### Discord login says the role is missing

- Confirm Developer Mode was enabled before copying IDs.
- Confirm `DISCORD_GUILD_ID` is the server ID, not a channel ID.
- Confirm `DISCORD_ADMIN_ROLE_IDS` contains role IDs, not role names.
- Restart the portal after editing `.env`.

## Publishing 09Test Portal to Git

The `.gitignore` excludes `.env`, dependencies, sessions, process IDs, and audit data. Never commit the Discord client secret or emergency password.

After creating an empty repository on your Git provider:

```powershell
cd C:\Servers\09test-portal
git init
git add .
git commit -m "Initial 09Test Portal"
git branch -M main
git remote add origin YOUR_REPOSITORY_URL
git push -u origin main
```

## Security

09Test Portal is intended to support authorized developers connecting over the internet with Discord authentication. It binds to `127.0.0.1` by default so the Node port is not publicly exposed on its own.

For remote access, place an HTTPS reverse proxy or secure tunnel in front of `127.0.0.1:24247`. Point a hostname such as `https://test.example.com` at that gateway, then set the Discord redirect to:

```text
https://test.example.com/auth/discord/callback
```

Do not directly port-forward `24247` without HTTPS. Before allowing internet access, the deployment should also use secure cookies, a persistent session store, proxy trust configuration, login rate limiting, CSRF protection, firewall restrictions, and at least one value in `DISCORD_ADMIN_ROLE_IDS`. Only trusted Discord roles should be allowed because authenticated users can build code, start or stop the server, and send server-console commands.
