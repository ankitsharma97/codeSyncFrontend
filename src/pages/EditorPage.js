import React, { useState } from 'react';
import { useParams, useLocation, useNavigate, Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FiPlay, FiLink, FiLogOut } from 'react-icons/fi';
import Editor from './Editor';
import Avatars from '../components/Avatars';
import { ConsolePanel, PreviewPanel } from '../components/OutputPanel';
import useCollab from '../hooks/useCollab';
import { LANGUAGES, getLanguage } from '../languages';
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
  const { ytext, awareness, users, status, language, setLanguage, run, publishRun } = useCollab(groupId, username);
  const [localStatus, setLocalStatus] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  const lang = getLanguage(language);
  const busy = run.status === 'running' && Date.now() - run.at < STALE_RUN_MS;

  const handleRun = async () => {
    if (!ytext || !lang.runnable || busy) return;
    setCollapsed(false);
    publishRun({ status: 'running', by: username, lang: language, at: Date.now() });
    const result = await runCode(language, ytext.toString(), { onStatus: setLocalStatus });
    setLocalStatus(null);
    publishRun({ status: 'done', by: username, lang: language, at: Date.now(), ...result });
  };

  const handleInvite = () => {
    const link = `${window.location.origin}/?room=${groupId}`;
    navigator.clipboard.writeText(link).then(
      () => toast.success('Invite link copied'),
      () => toast.error('Could not copy the link')
    );
  };

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

        <select className="select" value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language">
          {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>

        {!lang.preview && (
          <button
            className="btn primary"
            onClick={handleRun}
            disabled={!lang.runnable || busy}
            title={lang.runnable ? 'Run (⌘/Ctrl + Enter)' : 'Running supports JavaScript and Python'}
          >
            <FiPlay /> <span className="label">Run</span>
          </button>
        )}

        <button className="btn ghost" onClick={() => navigate('/')} aria-label="Leave room">
          <FiLogOut /> <span className="label">Leave</span>
        </button>
      </header>

      <main className="workspace">
        <div className="editorWrap">
          {status === 'disconnected' && <div className="banner">Connection lost — reconnecting. Your edits are kept and will sync.</div>}
          <Editor ytext={ytext} awareness={awareness} language={language} onRun={handleRun} />
        </div>

        {ytext && (lang.preview
          ? <PreviewPanel ytext={ytext} language={language} collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
          : <ConsolePanel
              run={run}
              localStatus={localStatus}
              canRun={lang.runnable}
              me={username}
              collapsed={collapsed}
              onToggle={() => setCollapsed(!collapsed)}
              onClear={() => publishRun({})}
            />)}
      </main>
    </div>
  );
}

export default EditorPage;
