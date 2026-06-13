# PlumeIde (Forge IDE) — CLAUDE.md

## What This Project Is

A mobile-first, AI-ready, decoupled IDE. The app is branded "Forge IDE" internally. It runs as a Vue 3 web app or as a Capacitor Android APK, connecting over WebSocket to a Node.js backend that handles all filesystem, git, shell, AI, and agent operations.

## Repo Layout

```
plume-ide/
├── backend/src/
│   ├── index.js          # WS server entry — auth, message routing, pty, file watching
│   ├── fs-utils.js       # ALL fs/git/shell ops go through here (path safety too)
│   ├── agent.js          # Agentic loop — multi-iteration tool-calling with MCP
│   ├── mcp-server.js     # Forge's own MCP server (exposes tools to external clients)
│   ├── mcp-client.js     # Connects to external MCP servers (context7, brave-search…)
│   ├── skills-runtime.js # Skills Protocol — action/instruction skill execution
│   └── context7.js       # Library doc fetching (pre-AI request, zero LLM calls)
└── frontend/src/
    ├── App.vue            # Root layout — header, editor area, panel teleports
    ├── main.js            # Pinia + Vue mount
    ├── stores/
    │   ├── socket.js      # WebSocket lifecycle + ALL request/push APIs
    │   ├── editor.js      # Tab management, dirty flag, auto-save
    │   ├── settings.js    # localStorage preferences, API key, model selection
    │   ├── ai.js          # Skill execution state, streaming text, diff hunks
    │   ├── agent.js       # Agent task state, thought stream, pinned files
    │   └── git.js         # Branch/status tracking, debounced refresh
    ├── components/        # See component map below
    ├── plugins/
    │   └── TermuxBridge.js  # Capacitor plugin bridging to MainActivity.kt
    ├── composables/useLanguage.js
    └── styles/global.css  # Design tokens (CSS vars), fonts, resets
```

## Running the Project

**Backend:**
```bash
cd backend && npm install && node src/index.js
```
Env vars: `FORGE_TOKEN`, `PROJECT_ROOT`, `PORT` (3001), `MCP_PORT` (3002), `SKILLS_PORT` (3003), `ANTHROPIC_API_KEY`, `AI_MODEL`

**Frontend (web dev):**
```bash
cd frontend && npm install && npm run dev   # port 5173
```

**Android build:**
```bash
cd frontend && npm run build
npx cap sync android
# open android/ in Android Studio or run via gradle
```

## Architecture Rules

### All file/git/shell ops go through `fs-utils.js`
Every handler in `index.js` calls into `fs-utils.js`. Never bypass it. It contains `safePath()` which prevents directory traversal — all paths must pass through it.

### WebSocket is the only channel between frontend and backend
No REST. No shared files. Everything is WebSocket messages.

**Request/response pattern (frontend → backend → frontend):**
```js
// client sends:
{ id: "req_123", type: "fs:read", payload: { path: "file.js" } }
// server responds:
{ id: "req_123", result: { content: "..." } }
// or on error:
{ id: "req_123", error: "File not found" }
```

**Push events (server → all clients, no `id`):**
```js
{ type: "fs:changed", event: "change", path: "file.js" }
{ type: "ai:delta", reqId: "ai_1", delta: "chunk" }
{ type: "pty:data", sessionId: "term_1", data: "..." }
```
Frontend components listen via `window.addEventListener('forge:push', handler)` — the socket store dispatches all inbound pushes as that custom event.

### socket.js is the single frontend API surface
All frontend code calls `socket.fs.*`, `socket.git.*`, `socket.pty.*`, `socket.ai.*`, etc. Never construct raw WebSocket messages outside of socket.js. To add a new API call: add a method to the relevant namespace object in socket.js.

## Component Map

| Component | Role |
|-----------|------|
| `ConnectScreen.vue` | Auth UI — server URL + token input |
| `CodeEditor.vue` | CodeMirror 6 wrapper with language detection |
| `TabBar.vue` | Multi-tab header row |
| `FileSidebar.vue` | File tree drawer with create/rename/delete |
| `Breadcrumbs.vue` | Path navigation bar |
| `AccessoryBar.vue` | Mobile symbol keyboard row |
| `StatusBar.vue` | Bottom bar — connection, git branch, language, save state |
| `CommandPalette.vue` | AI skill trigger (@fix, @explain, @refactor…) |
| `AIDiffViewer.vue` | Accept/reject code hunks from AI response |
| `ThoughtStream.vue` | Agent iteration log panel |
| `TerminalPanel.vue` | xterm.js PTY terminal, multi-session tabs |
| `GitPanel.vue` | Stage/unstage/commit/push/pull UI |
| `GrepPanel.vue` | Global text search results |
| `SkillsPanel.vue` | List, create, delete skills |
| `MCPPanel.vue` | Connect/manage MCP servers |
| `SettingsPanel.vue` | User preferences |

## WebSocket Message Types Reference

### Filesystem
`fs:read`, `fs:write`, `fs:list`, `fs:create`, `fs:delete`, `fs:rename`, `fs:search`, `fs:grep`, `fs:setRoot`

### Git
`git:status`, `git:diff`, `git:log`, `git:stage`, `git:unstage`, `git:stageAll`, `git:commit`, `git:push`, `git:pull`, `git:branches`, `git:checkout`, `git:newBranch`

### PTY / Terminal
`pty:create`, `pty:write` (fire-forget), `pty:resize` (fire-forget), `pty:kill` (fire-forget)

### AI
`ai:run` — fire-and-forget. Streaming responses come as `ai:delta` push events, terminated by `ai:done` or `ai:error`.

### Agent
`agent:run`, `agent:cancel` (fire-forget). Progress comes as `agent:thought`, `agent:done`, `agent:error` push events.

### Skills Protocol (JSON-RPC 2.0 passthrough)
`skills:rpc` with `{ method, params }` — wraps: `list_skills`, `describe_skill`, `execute_skill`, `run_code`, `create_blob`, `read_blob`
Also: `skills:create`, `skills:delete`

### MCP Client
`mcp:connect`, `mcp:disconnect`, `mcp:list`, `mcp:tools`, `mcp:call`, `mcp:resource`, `mcp:presets`

### Other
`shell:exec`, `snapshot:create/list/restore/delete`, `pins:get/set`, `settings:setLog`, `settings:setModel`

## State Stores (Pinia)

**`socket.js`** — owns the WS connection, all API namespaces, auth state. `status` can be: `disconnected | connecting | authenticating | connected | error`.

**`editor.js`** — tabs array, `activeTabId`, dirty tracking, debounced auto-save (2s). `closeAll()` is called when project root changes.

**`settings.js`** — persists to localStorage. Key fields: `anthropicKey`, `aiModel`, `fontSize`, `tabSize`, `wordWrap`, `autoSaveDelay`, `termFontSize`.

**`ai.js`** — `isRunning`, `currentSkill`, `streamedText`, `diffHunks[]`. `diffHunks` is computed line-by-line vs original content. Accept/reject operates per-hunk or bulk.

**`agent.js`** — `isRunning`, `thoughts[]` (capped 500), `error`, `summary`. Thought stream entries have `{ type, content, ts }`.

**`git.js`** — `branch`, `ahead`, `behind`, `fileStatus` (Map path→status). Refreshes on `fs:changed` push with 800ms debounce.

## Android / Capacitor

- App ID: `com.example.app`
- Entry: `frontend/android/app/src/main/java/com/example/app/MainActivity.kt`
- Registers `TermuxBridgePlugin` via `registerPlugin()` before `super.onCreate()`
- JS bridge: `frontend/src/plugins/TermuxBridge.js` — `registerPlugin('TermuxBridge', { web: fallback })`
- Web fallback throws `Error('TermuxBridge is only available on Android...')`
- `capacitor.plugins.json` — only for npm-installed Capacitor plugins; custom native plugins registered in Kotlin don't appear here

### TermuxBridge API
```js
import { TermuxBridge } from '@/plugins/TermuxBridge.js';

const { installed } = await TermuxBridge.isTermuxInstalled();
await TermuxBridge.runTermuxCommand({ command: 'ls ~' });
```
`runTermuxCommand` is **fire-and-forget** — uses Termux `RunCommandService` with `RUN_COMMAND_BACKGROUND: true`. No output is streamed back.

## Design System

CSS variables defined in `global.css` — always use these, never hardcode colors:

| Token | Purpose |
|-------|---------|
| `--bg-void` | Deepest background |
| `--bg-surface` | Panel/sidebar background |
| `--bg-raised` | Cards, dropdowns |
| `--bg-hover` | Hover states |
| `--accent` | Primary purple `#9d8fff` |
| `--text-primary` | Main text |
| `--text-muted` | De-emphasised text |
| `--border-subtle` | Dividers |
| `--font-mono` | JetBrains Mono, Fira Code |
| `--font-ui` | Geist, system-ui |

## AI / Agent Details

- Model default: `claude-opus-4-5` (overridable via `AI_MODEL` env or settings)
- Built-in skills: `@explain`, `@fix`, `@refactor`, `@docs`, `@tests`, `@optimize`
- Agent max iterations: 20
- MCP tools are cached in-memory per agent run
- forge-ide MCP server connects in-process via `InMemoryTransport` (no HTTP overhead for agent)
- Context7 fetches library docs async before AI request (zero extra LLM calls)

## Skills Protocol

Skills live in a directory scanned by `skills-runtime.js`. Each skill has:
- `skill.toml` — manifest (name, version, kind: `action|instruction`, inputs, runtime)
- `SKILL.md` — human+LLM description
- `index.js` or `index.py` — execution entry (action skills only)

Skills run sandboxed via `run_code` on port 3003 (JSON-RPC 2.0).

## File Snapshots

Stored in `.forge/snapshots/<path>/` as JSON. Before restore, a pre-restore snapshot is auto-created. Managed entirely in `fs-utils.js`.

## Common Patterns

**Adding a new WS message type:**
1. Handle it in `backend/src/index.js` switch/case
2. Implement logic in `backend/src/fs-utils.js` if it touches files
3. Add the API method to the right namespace in `frontend/src/stores/socket.js`

**Adding a new panel/drawer:**
1. Create `frontend/src/components/YourPanel.vue`
2. Use `<Teleport to="body">` for overlay panels
3. Wire show/hide to a `ref` in `App.vue`
4. Add a trigger button in the header or status bar

**Adding a Capacitor native method:**
1. Add `@PluginMethod fun yourMethod(call: PluginCall)` in `MainActivity.kt`
2. Mirror it in the web fallback class in `frontend/src/plugins/TermuxBridge.js`

## What Doesn't Exist Yet (known gaps)

- No iOS support (Android only for native)
- No split-pane editor
- No collaborative editing
- `context7.js` is imported but integration may be partial
- `pty:join` message type is listed in comments but may not be fully wired
