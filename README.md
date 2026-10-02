# CodeWithFriend — frontend

React app for [CodeWithFriend](https://github.com/ankitsharma97): a real-time collaborative code editor with a shared file tree, in-browser Python/JavaScript execution, live previews, and a terminal with a shared git repository.

Built with React 18 (Create React App), CodeMirror 6, [Yjs](https://yjs.dev) (`y-websocket`, `y-codemirror.next`), xterm.js, isomorphic-git and Pyodide.

## Run it

Requires **Node 24** (`nvm use` reads `.nvmrc`).

```bash
npm install
npm start                  # http://localhost:3000
```

It expects the backend at `ws://localhost:8000/ws/code_sync` — start the backend first (see its README), or point the app elsewhere with `REACT_APP_WS_URL`.

## Build

```bash
npm run build              # production bundle in build/
```

`.env.production` sets `REACT_APP_WS_URL` for production (it is baked in at build time). The git proxy URL is derived from it. If you host the static files yourself, add a rewrite `/*` → `/index.html` so deep links (`/editor/<room>`, `/docs`) work.

## Structure (`src/`)

| Folder | What's in it |
|---|---|
| `pages/` | `Home`, `EditorPage` (the room), `Editor` (CodeMirror + Yjs), `DocsPage` |
| `components/` | Explorer, tabs, output/preview dock, terminal panel, avatars, in-app guide |
| `hooks/useCollab.js` | Joins a room and exposes its shared state |
| `runner/` | Sandboxed JavaScript/Python execution (Web Workers, Pyodide) |
| `terminal/` | Shell, line editor, git commands, and the filesystem that maps the shared project for git |
| `utils/` | File-tree model, folder import, HTML bundling, Markdown rendering |
| `docs/` | Content of the in-app guide |

## Notes

- The whole project (file tree, file contents, git data, run output) lives in a single shared Yjs document.
- Code, git and the terminal run entirely in the browser; nothing untrusted runs on the server.
- There are no automated frontend tests yet — see `project.md` (Testing) for the plan.

Full architecture, design decisions and trade-offs: see **`project.md`** in the main project folder.
