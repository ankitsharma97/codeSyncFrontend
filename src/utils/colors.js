const COLORS = ['#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb7185', '#2dd4bf', '#fb923c'];

// Stable colour per name, shared by remote cursors and avatars.
export const colorFor = (name) => {
    let hash = 0;
    for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    return COLORS[Math.abs(hash) % COLORS.length];
};

export const initialsOf = (name) =>
    name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
