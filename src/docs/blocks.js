import React from 'react';
import toast from 'react-hot-toast';
import { FiCopy } from 'react-icons/fi';

const copy = (text) => navigator.clipboard.writeText(text).then(
    () => toast.success('Copied'),
    () => toast.error('Could not copy'),
);

// A terminal-style block. Lines starting with "$ " are commands (copied without the "$ ");
// everything else is shown as sample output.
export function Shell({ children }) {
    const lines = String(children).trim().split('\n');
    const commands = lines.filter((l) => l.startsWith('$ ')).map((l) => l.slice(2)).join('\n');
    return (
        <div className="docShell">
            {commands && (
                <button className="docCopy" onClick={() => copy(commands)} aria-label="Copy commands" title="Copy commands">
                    <FiCopy />
                </button>
            )}
            <pre>
                {lines.map((line, i) => (line.startsWith('$ ')
                    ? <span key={i} className="docCmd"><b>$</b> {line.slice(2)}{'\n'}</span>
                    : <span key={i} className="docOut">{line}{'\n'}</span>))}
            </pre>
        </div>
    );
}

export const Note = ({ tone = 'info', title, children }) => (
    <div className={`docNote ${tone}`}>
        {title && <b>{title}</b>}
        <div>{children}</div>
    </div>
);

export const Table = ({ head, rows }) => (
    <div className="docTableWrap">
        <table className="docTable">
            <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
        </table>
    </div>
);

export const K = ({ children }) => <kbd>{children}</kbd>;
export const C = ({ children }) => <code className="docCode">{children}</code>;
