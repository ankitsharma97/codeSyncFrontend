import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate, Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FiPlay, FiLink, FiLogOut, FiFilePlus, FiHelpCircle, FiMessageSquare } from 'react-icons/fi';
import Editor from './Editor';
import Avatars from '../components/Avatars';
import Explorer from '../components/Explorer';
import Tabs from '../components/Tabs';
import { ConsoleBody, consoleChrome, Dock, PreviewBody } from '../components/OutputPanel';
import TerminalPanel from '../components/TerminalPanel';
import { DocsDialog } from '../components/Docs';
import ChatPanel from '../components/ChatPanel';
import { sendMessage, userId } from '../utils/chat';
import { colorFor } from '../utils/colors';
import useCollab from '../hooks/useCollab';
import { LANGUAGES, detectLanguage, getLanguage } from '../languages';
import { importIntoProject } from '../utils/importFiles';
import { buildTree, createNode, deleteNode, flatten, moveNode, pathsById, renameNode, setLanguage } from '../utils/fs';
import { runCode } from '../runner';

const STALE_RUN_MS = 60000; // a "running" record older than this belongs to a client that vanished

function EditorPage() {
  const { groupId } = useParams();
  const { username } = useLocation().state || {};

  // Opened via a shared link: ask for a username first.
  if (!username) return <Navigate to={`/?room=${groupId}`} replace />;
  return <Room groupId={groupId} username={username} />;
}

function Room({ groupId, username }) {
  const navigate = useNavigate();
  const { files, gitfs, awareness, users, nodes, ready, status, run, publishRun, chat, messages } = useCollab(groupId, username);
  const [localStatus, setLocalStatus] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [panel, setPanel] = useState('main'); // 'main' = Output or Preview, or 'terminal'
  const [terminalOpened, setTerminalOpened] = useState(false);
  const [dockHeight, setDockHeight] = useState(0);
  const [docs, setDocs] = useState(null); // section id while the guide is open
  const [chatOpen, setChatOpen] = useState(() => {
    try { return localStorage.getItem('cwf:chat') === '1' && window.matchMedia('(min-width: 1101px)').matches; } catch { return false; }
  });
  const [seen, setSeen] = useState(null); // how many messages this person has already read
  const myUid = useMemo(userId, []);
  const [openIds, setOpenIds] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [explorerOpen, setExplorerOpen] = useState(() => window.matchMedia('(min-width: 901px)').matches);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes; // imports run long enough that the render-time snapshot can go stale

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const paths = useMemo(() => pathsById(nodes), [nodes]);
  const pathToId = useMemo(() => {
    const map = new Map();
    nodes.forEach((n) => { if (n.kind === 'file') map.set(paths[n.id], n.id); });
    return map;
  }, [nodes, paths]);

  // Keep tabs and the active file valid as people create, rename and delete files.
  useEffect(() => {
    if (!ready) return;
    const isFile = (id) => nodeById.get(id)?.kind === 'file';
    const validTabs = openIds.filter(isFile);
    let next = validTabs;
    if (!isFile(activeId)) {
      const fallback = validTabs[validTabs.length - 1] || flatten(buildTree(nodes)).find((n) => n.kind === 'file')?.id || null;
      if (fallback && !next.includes(fallback)) next = [...next, fallback];
      setActiveId(fallback);
    }
    if (next.length !== openIds.length || next.some((id, i) => id !== openIds[i])) setOpenIds(next);
  }, [nodes, ready, nodeById, openIds, activeId]);

  useEffect(() => { awareness?.setLocalStateField('file', activeId); }, [awareness, activeId]);

  // History that was already there when you joined counts as read; only newer messages are "unread".
  useEffect(() => {
    if (!ready) return;
    if (seen === null || chatOpen) setSeen(messages.length);
  }, [ready, messages.length, chatOpen, seen]);

  const unread = !chatOpen && seen !== null ? messages.slice(Math.min(seen, messages.length)).filter((m) => m.uid !== myUid).length : 0;
  const typingNames = users.filter((u) => u.typing && u.clientId !== awareness?.clientID).map((u) => u.name);

  const toggleChat = (open) => {
    setChatOpen(open);
    try { localStorage.setItem('cwf:chat', open ? '1' : '0'); } catch { /* storage unavailable */ }
    if (open && !window.matchMedia('(min-width: 901px)').matches) setExplorerOpen(false);
  };

  const postMessage = (text) => sendMessage(chat, { uid: myUid, user: username, color: colorFor(username), text });

  const active = nodeById.get(activeId);
  const ytext = active && files?.get(activeId)?.get('text');
  const language = active ? (active.lang || detectLanguage(active.name)) : 'text';
  const lang = getLanguage(language);
  const entryPath = active ? paths[active.id] : '';
  const busy = run.status === 'running' && Date.now() - run.at < STALE_RUN_MS;

  const readFile = (path) => {
    const id = pathToId.get(path);
    return id ? files.get(id).get('text').toString() : null;
  };

  const openFile = (id) => {
    setOpenIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    setActiveId(id);
    if (!window.matchMedia('(min-width: 901px)').matches) setExplorerOpen(false);
  };

  const showPanel = (id) => {
    setPanel(id);
    if (id === 'terminal') setTerminalOpened(true);
  };

  const openByPath = (path) => {
    const id = pathToId.get(path.replace(/^\//, ''));
    if (id) openFile(id);
  };

  const closeTab = (id) => {
    const index = openIds.indexOf(id);
    const remaining = openIds.filter((t) => t !== id);
    setOpenIds(remaining);
    if (id === activeId) setActiveId(remaining[Math.min(index, remaining.length - 1)] || null);
  };

  const actions = {
    create: (spec) => createNode(files, nodes, spec),
    rename: (id, name) => renameNode(files, nodes, id, name),
    move: (id, parent) => moveNode(files, nodes, id, parent),
    remove: (id) => deleteNode(files, nodes, id),
    importFiles: (items, parent) => importIntoProject(files, nodesRef.current, parent, items),
  };

  const handleRun = async () => {
    if (!ytext || !lang.runnable || busy) return;
    setCollapsed(false);
    setPanel('main');
    publishRun({ status: 'running', by: username, lang: language, at: Date.now() });
    const project = {};
    pathToId.forEach((id, path) => { project[path] = files.get(id).get('text').toString(); });
    const result = await runCode(language, ytext.toString(), { files: project, entry: entryPath, onStatus: setLocalStatus });
    setLocalStatus(null);
    publishRun({ status: 'done', by: username, lang: language, file: entryPath, at: Date.now(), ...result });
  };

  const handleInvite = () => {
    const link = `${window.location.origin}/?room=${groupId}`;
    navigator.clipboard.writeText(link).then(
      () => toast.success('Invite link copied'),
      () => toast.error('Could not copy the link')
    );
  };

  const tabs = openIds.map((id) => nodeById.get(id)).filter(Boolean);

  return (
    <div className="room">
      <header className="topbar">
        <div className="brand">
          <img src="/cwf3.png" alt="CodeWithFriend" className="brandLogo" />
        </div>

        <button className="roomChip" onClick={handleInvite} title="Copy invite link">
          <i className={`dot ${status}`} />
          <span className="roomId">{groupId}</span>
          <FiLink />
        </button>

        <span className="spacer" />
        <span className="break" />

        <Avatars users={users} me={username} />

        <select
          className="select"
          value={language}
          onChange={(e) => setLanguage(files, activeId, e.target.value)}
          disabled={!active}
          aria-label="Language"
        >
          {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>

        {!lang.preview && (
          <button
            className="btn primary"
            onClick={handleRun}
            disabled={!active || !lang.runnable || busy}
            title={lang.runnable ? 'Run this file (⌘/Ctrl + Enter)' : 'Running supports JavaScript and Python'}
          >
            <FiPlay /> <span className="label">Run</span>
          </button>
        )}

        <button className="btn ghost chatBtn" onClick={() => toggleChat(!chatOpen)} aria-label={`Chat${unread ? `, ${unread} unread` : ''}`} aria-pressed={chatOpen} title="Chat">
          <FiMessageSquare />
          {unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
        </button>

        <button className="btn ghost helpBtn" onClick={() => setDocs('start')} aria-label="Open the guide" title="Guide">
          <FiHelpCircle />
        </button>

        <button className="btn ghost" onClick={() => navigate('/')} aria-label="Leave room">
          <FiLogOut /> <span className="label">Leave</span>
        </button>
      </header>

      <main className="workspace">
        {explorerOpen && <div className="scrim" onClick={() => setExplorerOpen(false)} />}
        <aside className={`explorer ${explorerOpen ? 'open' : ''}`}>
          <Explorer
            nodes={nodes}
            activeId={activeId}
            users={users}
            selfClientId={awareness?.clientID}
            actions={actions}
            onOpen={openFile}
          />
        </aside>

        <div className="main">
          <Tabs
            tabs={tabs}
            activeId={activeId}
            onSelect={openFile}
            onClose={closeTab}
            explorerOpen={explorerOpen}
            onToggleExplorer={() => setExplorerOpen(!explorerOpen)}
          />

          <div className="editorWrap">
            {status === 'disconnected' && <div className="banner">Connection lost — reconnecting. Your edits are kept and will sync.</div>}
            {ytext
              ? <Editor ytext={ytext} awareness={awareness} language={language} onRun={handleRun} />
              : (
                <div className="emptyState">
                  {ready ? (
                    <>
                      <p>No file open</p>
                      <p className="muted">Pick a file from the explorer, or create a new one.</p>
                      <button className="btn ghost" onClick={() => setExplorerOpen(true)}><FiFilePlus /> Open explorer</button>
                    </>
                  ) : <p className="muted">Loading project…</p>}
                </div>
              )}
          </div>

          {ready && (() => {
            const showPreview = ytext && lang.preview;
            const chrome = showPreview || panel === 'terminal' ? {} : consoleChrome({ run, localStatus, me: username, onClear: () => publishRun({}) });
            return (
              <Dock
                tabs={[
                  { id: 'main', label: showPreview ? (language === 'markdown' ? 'Markdown preview' : 'Live preview') : 'Output' },
                  { id: 'terminal', label: 'Terminal' },
                ]}
                active={panel}
                onTab={showPanel}
                meta={panel === 'main' ? chrome.meta : null}
                actions={panel === 'main' ? chrome.actions : null}
                collapsed={collapsed}
                onToggle={() => setCollapsed(!collapsed)}
                tall={panel === 'main' && showPreview}
                onHeight={setDockHeight}
              >
                <div className="dockPane" hidden={panel !== 'main'}>
                  {showPreview
                    ? <PreviewBody key={activeId} ytext={ytext} files={files} language={language} entryPath={entryPath} readFile={readFile} />
                    : <ConsoleBody run={run} canRun={lang.runnable} />}
                </div>
                {terminalOpened && (
                  <div className="dockPane" hidden={panel !== 'terminal'}>
                    <TerminalPanel
                      files={files}
                      gitfs={gitfs}
                      username={username}
                      visible={panel === 'terminal' && !collapsed}
                      height={dockHeight}
                      onOpenFile={openByPath}
                      onOpenDocs={setDocs}
                    />
                  </div>
                )}
              </Dock>
            );
          })()}
        </div>

        {chatOpen && <div className="scrim chatScrim" onClick={() => toggleChat(false)} />}
        <ChatPanel
          open={chatOpen}
          messages={messages}
          myUid={myUid}
          typingNames={typingNames}
          onSend={postMessage}
          onTyping={(typing) => awareness?.setLocalStateField('typing', typing)}
          onClose={() => toggleChat(false)}
        />
      </main>
      {docs && <DocsDialog section={docs} onSection={setDocs} onClose={() => setDocs(null)} />}
    </div>
  );
}

export default EditorPage;
