// SOMI-CANARY-N35-e5bc70e2ce383791
const sat = async (l) => (await l('src/semver.mjs')).satisfies;
const table = (rows) => async (l) => { const s = await sat(l); return rows.map(([v, r]) => { try { return s(v, r); } catch { return 'threw'; } }); };
const group = (name, rows) => ({ name, run: table(rows.map((r) => r.slice(0, 2))), expect: rows.map((r) => r[2]) });
export const cases = [
  group('AC2 [functional] plain versions and comparators', [['1.2.3', '1.2.3', true], ['1.2.4', '1.2.3', false], ['1.2.3', '=1.2.3', true], ['2.0.0', '>1.2.3', true], ['1.2.3', '>1.2.3', false], ['1.2.3', '>=1.2.3 <2.0.0', true], ['2.0.0', '>=1.2.3 <2.0.0', false], ['1.2.3', '<=1.2.3', true]]),
  group('AC2 [functional] or', [['3.1.0', '1.x || >=3 <4', true], ['2.0.0', '1.x || >=3 <4', false], ['1.9.9', '1.x || >=3 <4', true]]),
  group('AC2 [functional] caret above zero', [['1.9.9', '^1.2.3', true], ['1.2.2', '^1.2.3', false], ['2.0.0', '^1.2.3', false]]),
  group('AC2 [boundary] caret under one', [['0.2.9', '^0.2.3', true], ['0.3.0', '^0.2.3', false], ['0.0.3', '^0.0.3', true], ['0.0.4', '^0.0.3', false], ['0.0.9', '^0.0', true], ['0.1.0', '^0.0', false], ['0.9.0', '^0', true], ['1.0.0', '^0', false], ['0.5.0', '^0.x', true]]),
  group('AC2 [functional] tilde', [['1.2.9', '~1.2.3', true], ['1.3.0', '~1.2.3', false], ['1.2.9', '~1.2', true], ['1.9.0', '~1', true], ['2.0.0', '~1', false], ['0.2.9', '~0.2.3', true]]),
  group('AC2 [boundary] partial versions and wildcards', [['1.5.0', '1', true], ['1.5.0', '1.x', true], ['1.5.9', '1.5', true], ['1.6.0', '1.5.x', false], ['9.9.9', '*', true], ['9.9.9', '', true], ['9.9.9', 'x', true], ['1.2.3', '1.*.3', true]]),
  group('AC2 [boundary] a comparator on a partial version', [['1.3.0', '>1.2', true], ['1.2.9', '>1.2', false], ['1.2.9', '<=1.2', true], ['1.3.0', '<=1.2', false], ['1.1.9', '<1.2', true], ['1.2.0', '<1.2', false], ['2.0.0', '>1', true], ['1.9.0', '>1', false], ['1.9.0', '<=1', true], ['1.0.0', '>=1', true], ['0.0.0', '<*', false], ['1.0.0', '>*', false]]),
  group('AC2 [functional] hyphen ranges', [['1.5.0', '1.2.3 - 2.3.4', true], ['2.3.4', '1.2.3 - 2.3.4', true], ['2.3.5', '1.2.3 - 2.3.4', false], ['1.2.2', '1.2.3 - 2.3.4', false]]),
  group('AC2 [boundary] hyphen ranges with partial ends', [['2.3.9', '1.2.3 - 2.3', true], ['2.4.0', '1.2.3 - 2.3', false], ['2.9.9', '1.2.3 - 2', true], ['3.0.0', '1.2.3 - 2', false], ['1.2.0', '1.2 - 2.3.4', true], ['1.1.9', '1.2 - 2.3.4', false]]),
  group('AC2 [boundary] a prerelease matches only a range that names one on the same version', [['1.2.3-beta.2', '^1.2.3-beta.1', true], ['1.2.4-beta.2', '^1.2.3-beta.1', false], ['1.3.0-beta', '^1.2.0', false], ['1.0.0-rc.1', '*', false], ['2.0.0-alpha', '<2.0.0', false], ['1.2.3-rc.1', '>=1.2.3-beta.1 <1.3.0', true], ['1.2.3-rc.1', '>=1.2.0 <1.3.0 || >=1.2.3-alpha', true], ['1.2.3-alpha', '>=1.2.3-beta', false]]),
  group('AC2 [boundary] prerelease order', [['1.0.0-alpha.1', '>1.0.0-alpha', true], ['1.0.0-alpha.beta', '>1.0.0-alpha.1', true], ['1.0.0-beta', '>1.0.0-alpha.beta', true], ['1.0.0-beta.11', '>1.0.0-beta.2', true], ['1.0.0-rc.1', '>1.0.0-beta.11', true], ['1.0.0', '>1.0.0-rc.1', true], ['1.0.0-1', '<1.0.0-alpha', true], ['1.0.0-beta.2', '>1.0.0-beta.11', false]]),
  group('AC2 [boundary] build metadata and a leading v do not matter', [['1.2.3+build.5', '1.2.3', true], ['1.2.3', '1.2.3+other', true], ['v1.2.3', '1.2.3', true], ['1.2.3', 'v1.2.3', true], ['1.2.3+a', '^1.2.0', true]]),
  group('AC2 [boundary] spaces after an operator', [['1.2.3', '>= 1.2.3', true], ['1.3.0', '^ 1.2.0', true], ['1.9.0', '~ 1.2 || >= 1.9', true]]),
  group('AC3 [boundary] an invalid version or range is false, and does not throw', [['1.2', '*', false], ['not', '*', false], ['01.2.3', '*', false], ['1.2.3', 'nonsense', false], ['1.2.3', '>=a.b', false], ['1.2.3-01', '*', false]]),
  { name: 'AC4 [functional] canInstall uses it', run: async (l) => { const { canInstall } = await l('src/plugins.mjs'); const p = { engines: { host: '>=1.5 <3 || 4.x' } }; return [canInstall(p, '1.4.0'), canInstall(p, '1.5.0'), canInstall(p, '3.0.0'), canInstall(p, '4.2.0')]; }, expect: [false, true, false, true] },
  { name: 'AC3 [regression] a plugin with no range installs', run: async (l) => (await l('src/plugins.mjs')).canInstall({ name: 'a' }, '1.0.0'), expect: true },
];
