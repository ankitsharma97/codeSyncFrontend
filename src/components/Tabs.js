import React from 'react';
import { FiX, FiSidebar } from 'react-icons/fi';
import { badgeFor, detectLanguage } from '../languages';

function Tabs({ tabs, activeId, onSelect, onClose, onToggleExplorer, explorerOpen }) {
    return (
        <div className="tabs" role="tablist">
            <button className={`iconBtn explorerToggle ${explorerOpen ? 'on' : ''}`} onClick={onToggleExplorer} aria-label="Toggle file explorer" title="Files">
                <FiSidebar />
            </button>
            {tabs.map((tab) => {
                const [label, color] = badgeFor(tab.lang || detectLanguage(tab.name));
                return (
                    <div
                        key={tab.id}
                        role="tab"
                        aria-selected={tab.id === activeId}
                        className={`tab ${tab.id === activeId ? 'active' : ''}`}
                        onClick={() => onSelect(tab.id)}
                        onAuxClick={(e) => { if (e.button === 1) onClose(tab.id); }}
                    >
                        <span className="fileBadge" style={{ color }}>{label}</span>
                        <span className="tabName">{tab.name}</span>
                        <button className="iconBtn tabClose" aria-label={`Close ${tab.name}`} onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}><FiX /></button>
                    </div>
                );
            })}
        </div>
    );
}

export default Tabs;
