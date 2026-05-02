# ⚡ Forge IDE — Phase 1

A mobile-first, decoupled AI-ready IDE.  
**Backend**: Node.js WebSocket server · **Frontend**: Vue 3 + CodeMirror 6

---

## Quick Start

### 1. Backend

```bash
cd backend
npm install
node src/index.js
```

The server prints an **auth token** on first run:

```
🔑 FORGE AUTH TOKEN: abc123...

🔥 Forge IDE backend running on ws://127.0.0.1:3001
📁 Project root: /your/current/directory
```

**Options via env vars:**
```bash
FORGE_TOKEN=mysecrettoken   # Fix the token (required for persistence across restarts)
PROJECT_ROOT=/path/to/project  # Set working directory
PORT=3001                   # Change port
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## Architecture

```
forge-ide/
├── backend/
│   ├── src/
│   │   └── index.js        # WS server, auth, fs/git/shell handlers
│   └── package.json
└── frontend/
    ├── src/
    │   ├── App.vue          # Root layout
    │   ├── main.js
    │   ├── styles/
    │   │   └── global.css   # Design tokens, CM overrides
    │   ├── stores/
    │   │   ├── socket.js    # WS auth + request/response protocol
    │   │   └── editor.js    # Tabs, dirty state, auto-save
    │   ├── composables/
    │   │   └── useLanguage.js  # Language detection for CodeMirror
    │   └── components/
    │       ├── ConnectScreen.vue   # Auth UI
    │       ├── CodeEditor.vue      # CodeMirror 6 editor
    │       ├── AccessoryBar.vue    # Mobile keyboard symbols bar
    │       ├── TabBar.vue          # Multi-tab with dirty dots
    │       ├── FileSidebar.vue     # Slide-out file tree drawer
    │       ├── TreeNode.vue        # Recursive file tree node
    │       ├── Breadcrumbs.vue     # Path breadcrumbs
    │       └── StatusBar.vue       # Bottom status bar
    ├── index.html
    ├── vite.config.js
    └── package.json
```

---

## Phase 1 Features

### Security
- ✅ Server binds to `127.0.0.1` only (loopback)
- ✅ Token-based auth handshake on every connection
- ✅ Path traversal protection on all file operations

### Editor
- ✅ CodeMirror 6 with One Dark theme
- ✅ Syntax highlighting: JS, TS, JSX, TSX, Python, HTML, CSS, Markdown, Go
- ✅ Autocomplete + bracket matching + fold gutter
- ✅ Keyboard accessory bar (Tab, braces, symbols, undo/redo, cursor arrows)
- ✅ Auto-save: debounced 2s after last keystroke
- ✅ Smart indent via CodeMirror's `indentOnInput`
- ✅ Cmd/Ctrl+S manual save

### Tabs
- ✅ Multi-tab with horizontal scroll
- ✅ Dirty state dot indicators
- ✅ Per-tab close button

### File Management
- ✅ Recursive file tree via slide-out sidebar
- ✅ Create file / Create folder
- ✅ Rename (inline, via context menu)
- ✅ Delete (with confirmation)
- ✅ Fuzzy filename search
- ✅ Backend-powered grep (global text search)

### Navigation
- ✅ Breadcrumb path bar
- ✅ Status bar: connection status, git branch, language, save state

### Backend API
- ✅ `fs:read` / `fs:write` / `fs:list` / `fs:create` / `fs:delete` / `fs:rename`
- ✅ `fs:search` (filename fuzzy), `fs:grep` (content search)
- ✅ `git:status` / `git:diff` / `git:log`
- ✅ `shell:exec`

---

## Phase 2 Preview

Next phase adds:
- Global grep results panel with line previews
- Git panel: stage, commit, push/pull, branch switcher
- File watcher: live tree updates via chokidar
- Split editor panes

## Phase 3+

- Integrated terminal (xterm.js)
- AI diff viewer (accept/reject hunks)
- MCP client + skill registry
- Agentic loop + thought stream UI
