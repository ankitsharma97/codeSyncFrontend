const wrap = (code) => (text) => `\x1b[${code}m${text}\x1b[0m`;
export const c = {
    bold: wrap('1'), dim: wrap('2'), red: wrap('31'), green: wrap('32'), yellow: wrap('33'),
    blue: wrap('34'), magenta: wrap('35'), cyan: wrap('36'), gray: wrap('90'), boldBlue: wrap('1;34'),
};
