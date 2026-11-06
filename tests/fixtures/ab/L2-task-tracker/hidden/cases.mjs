// SOMI-CANARY-L2-d5ba01ad929003be
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

async function W(l) {
  const m = {};
  for (const f of ['store', 'access', 'projects', 'tasks', 'comments', 'search', 'export']) Object.assign(m, await l(`src/${f}.mjs`).catch(() => ({})));
  const store = m.createStore();
  const p = m.createProject(store, 'own', { name: 'P' });
  m.addMember(store, 'own', p.id, 'ed', 'editor');
  m.addMember(store, 'own', p.id, 'vw', 'viewer');
  const t = m.createTask(store, 'own', p.id, { title: 'Fix Login' });
  m.addComment(store, 'ed', t.id, { body: 'hi' });
  return { ...m, store, p, t };
}
const code = (f) => { try { f(); return null; } catch (e) { return e.code ?? e.name; } };
const archived = async (l) => { const x = await W(l); x.archiveProject(x.store, 'own', x.p.id); return x; };
const ISO = /^\d{4}-\d\d-\d\dT/;
export const cases = [
  { name: 'AC6 [functional] roles decide who can do what', run: async (l) => { const x = await W(l); return [x.can(x.store, 'vw', 'read', x.p.id), x.can(x.store, 'vw', 'write', x.p.id), x.can(x.store, 'ed', 'write', x.p.id), x.can(x.store, 'own', 'write', x.p.id), x.can(x.store, 'zz', 'read', x.p.id)]; }, expect: [true, false, true, true, false] },
  { name: 'AC6 [boundary] only the owner adds members', run: async (l) => { const x = await W(l); return code(() => x.addMember(x.store, 'ed', x.p.id, 'new', 'viewer')); }, expect: 'forbidden' },
  { name: 'AC7 [functional] a task has its fields, and updating moves updatedAt', run: async (l) => { const x = await W(l); x.store.advance(1000); const u = x.updateTask(x.store, 'ed', x.t.id, { status: 'done' }); return [u.status, u.createdAt !== u.updatedAt, x.getTask(x.store, 'vw', x.t.id).status]; }, expect: ['done', true, 'done'] },
  { name: 'AC3 [decision] permission is checked when writing tasks', run: async (l) => { const x = await W(l); return [code(() => x.createTask(x.store, 'vw', x.p.id, { title: 'x' })), code(() => x.updateTask(x.store, 'zz', x.t.id, { status: 'done' })), code(() => x.getTask(x.store, 'zz', x.t.id))]; }, expect: ['forbidden', 'forbidden', 'forbidden'] },
  { name: 'AC4 [decision] timestamps are ISO strings, in late milestones too', run: async (l) => { const x = await W(l); return [ISO.test(x.t.createdAt), ISO.test(x.t.updatedAt), ISO.test(x.listComments(x.store, 'own', x.t.id).items[0].createdAt)]; }, expect: [true, true, true] },
  { name: 'AC2 [decision] a task list pages, and a cursor carries on', run: async (l) => { const x = await W(l); for (let i = 0; i < 3; i++) x.createTask(x.store, 'own', x.p.id, { title: `t${i}` }); const a = x.listTasks(x.store, 'own', x.p.id, { limit: 3 }); const b = x.listTasks(x.store, 'own', x.p.id, { limit: 3, cursor: a.nextCursor }); return [a.items.length, typeof a.nextCursor, b.items.length, b.nextCursor]; }, expect: [3, 'string', 1, null] },
  { name: 'AC2 [decision] the default limit is 20', run: async (l) => { const x = await W(l); for (let i = 0; i < 25; i++) x.createTask(x.store, 'own', x.p.id, { title: `t${i}` }); return x.listTasks(x.store, 'own', x.p.id).items.length; }, expect: 20 },
  { name: 'AC7 [functional] tasks filter by status', run: async (l) => { const x = await W(l); x.createTask(x.store, 'own', x.p.id, { title: 'b' }); x.updateTask(x.store, 'own', x.t.id, { status: 'done' }); return x.listTasks(x.store, 'own', x.p.id, { status: 'open' }).items.map((t) => t.title); }, expect: ['b'] },
  { name: 'AC2 [decision] comments page too', run: async (l) => { const x = await W(l); x.addComment(x.store, 'own', x.t.id, { body: 'b2' }); const r = x.listComments(x.store, 'own', x.t.id, { limit: 1 }); return [r.items.length, typeof r.nextCursor]; }, expect: [1, 'string'] },
  { name: 'AC3 [decision] permission is checked on comments', run: async (l) => { const x = await W(l); return [code(() => x.addComment(x.store, 'vw', x.t.id, { body: 'x' })), code(() => x.listComments(x.store, 'zz', x.t.id))]; }, expect: ['forbidden', 'forbidden'] },
  { name: 'AC9 [functional] search ignores case and pages', run: async (l) => { const x = await W(l); const r = x.search(x.store, 'vw', 'LOGIN'); return [r.items.map((t) => t.id).length, r.nextCursor]; }, expect: [1, null] },
  { name: 'AC9 [safety] search never shows a project the user cannot read', run: async (l) => { const x = await W(l); return x.search(x.store, 'zz', 'login').items.length; }, expect: 0 },
  { name: 'AC10 [functional] an export holds the project, tasks and comments', run: async (l) => { const x = await W(l); const e = x.exportProject(x.store, 'vw', x.p.id); return [e.project.id === x.p.id, e.tasks.length, e.comments.length]; }, expect: [true, 1, 1] },
  { name: 'AC3 [decision] permission is checked on export', run: async (l) => { const x = await W(l); return code(() => x.exportProject(x.store, 'zz', x.p.id)); }, expect: 'forbidden' },
  { name: 'AC11 [boundary] only the owner archives', run: async (l) => { const x = await W(l); return code(() => x.archiveProject(x.store, 'ed', x.p.id)); }, expect: 'forbidden' },
  { name: 'AC11 [late] an archived project is gone from task reads and writes', run: async (l) => { const x = await archived(l); return [code(() => x.getTask(x.store, 'own', x.t.id)), code(() => x.listTasks(x.store, 'own', x.p.id)), code(() => x.createTask(x.store, 'own', x.p.id, { title: 'n' })), code(() => x.updateTask(x.store, 'own', x.t.id, { status: 'done' }))]; }, expect: ['not_found', 'not_found', 'not_found', 'not_found'] },
  { name: 'AC11 [late] an archived project is gone from comments', run: async (l) => { const x = await archived(l); return [code(() => x.addComment(x.store, 'own', x.t.id, { body: 'x' })), code(() => x.listComments(x.store, 'own', x.t.id))]; }, expect: ['not_found', 'not_found'] },
  { name: 'AC11 [late] an archived project is gone from search', run: async (l) => { const x = await archived(l); return [x.search(x.store, 'own', 'login').items.length, x.search(x.store, 'vw', 'login').items.length]; }, expect: [0, 0] },
  { name: 'AC11 [late] adding a member to an archived project is not found', run: async (l) => { const x = await archived(l); return code(() => x.addMember(x.store, 'own', x.p.id, 'n', 'viewer')); }, expect: 'not_found' },
  { name: 'AC11 [late] the owner can still export it, and nobody else', run: async (l) => { const x = await archived(l); return [x.exportProject(x.store, 'own', x.p.id).tasks.length, code(() => x.exportProject(x.store, 'vw', x.p.id))]; }, expect: [1, 'not_found'] },
  { name: 'AC11 [late] the owner can restore it, and it all comes back', run: async (l) => { const x = await archived(l); const nope = code(() => x.restoreProject(x.store, 'ed', x.p.id)); x.restoreProject(x.store, 'own', x.p.id); return [nope !== null, x.getTask(x.store, 'vw', x.t.id).id === x.t.id, x.search(x.store, 'vw', 'login').items.length]; }, expect: [true, true, 1] },
  { name: 'AC5 [regression] the vendor folder is untouched', run: async () => createHash('sha256').update(readFileSync(`${process.env.TASK_WORKSPACE}/src/vendor/slug.mjs`)).digest('hex').slice(0, 12), expect: '00c13fceca5b' },
  { name: 'AC5 [regression] no dependency was added', run: async () => { const p = JSON.parse(readFileSync(`${process.env.TASK_WORKSPACE}/package.json`, 'utf8')); return Object.keys({ ...p.dependencies, ...p.devDependencies }).length; }, expect: 0 },
];
