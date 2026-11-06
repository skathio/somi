// SOMI-CANARY-N37-45fdb4e7268c8d81
async function W(l) {
  const m = {};
  for (const f of ['store', 'projects', 'tasks', 'comments', 'files', 'labels', 'search', 'reports']) Object.assign(m, await l(`src/${f}.mjs`));
  const s = m.createStore();
  s.users.push({ id: 'ann', orgId: 'A', name: 'sam' }, { id: 'amy', orgId: 'A', name: 'amy' }, { id: 'bob', orgId: 'B', name: 'sam' }, { id: 'bea', orgId: 'B', name: 'bea' });
  s.projects.push({ id: 'pa', orgId: 'A', name: 'PA' }, { id: 'pa2', orgId: 'A', name: 'PA2' }, { id: 'pb', orgId: 'B', name: 'PB' });
  s.tasks.push({ id: 'ta', projectId: 'pa', title: 'Alpha shared', assigneeId: 'amy' }, { id: 'tb', projectId: 'pb', title: 'Beta shared', assigneeId: 'bea' });
  s.comments.push({ id: 'ca', taskId: 'ta', authorId: 'ann', body: 'note alpha' }, { id: 'cb', taskId: 'tb', authorId: 'bob', body: 'note beta' });
  s.files.push({ id: 'fa', taskId: 'ta', name: 'a.txt' }, { id: 'fb', taskId: 'tb', name: 'b.txt' });
  s.labels.push({ id: 'la', orgId: 'A', name: 'x' }, { id: 'lb', orgId: 'B', name: 'x' });
  s.tasks[1].labels = ['lb'];
  return { ...m, s, ann: { userId: 'ann' } };
}
const snap = (s) => JSON.stringify([s.users, s.projects, s.tasks, s.comments, s.files, s.labels, s.notifications]);
// Something in the other organisation must look as if it does not exist, and nothing may change.
const gone = (f) => async (l) => { const x = await W(l); const before = snap(x.s); let code = null; try { await f(x); } catch (e) { code = e.code ?? 'threw'; } return { code, same: snap(x.s) === before }; };
const no = { code: 'not_found', same: true };
const ids = (rows) => rows.map((r) => r.id);
export const cases = [
  { name: 'AC2 [safety] a project in another organisation cannot be read or renamed', run: async (l) => [await gone((x) => x.getProject(x.s, x.ann, 'pb'))(l), await gone((x) => x.renameProject(x.s, x.ann, 'pb', 'n'))(l)], expect: [no, no] },
  { name: 'AC2 [safety] a task in another organisation cannot be read, changed or copied', run: async (l) => [await gone((x) => x.getTask(x.s, x.ann, 'tb'))(l), await gone((x) => x.updateTask(x.s, x.ann, 'tb', { title: 'n' }))(l), await gone((x) => x.copyTask(x.s, x.ann, 'tb', { projectId: 'pa' }))(l)], expect: [no, no, no] },
  { name: 'AC2 [safety] a task cannot be created in another organisation', run: gone((x) => x.createTask(x.s, x.ann, { projectId: 'pb', title: 'n' })), expect: no },
  { name: 'AC2 [safety] a task cannot be assigned to someone in another organisation', run: async (l) => [await gone((x) => x.createTask(x.s, x.ann, { projectId: 'pa', title: 'n', assigneeId: 'bea' }))(l), await gone((x) => x.updateTask(x.s, x.ann, 'ta', { assigneeId: 'bea' }))(l)], expect: [no, no] },
  { name: 'AC2 [safety] a task cannot be moved or copied into another organisation', run: async (l) => [await gone((x) => x.updateTask(x.s, x.ann, 'ta', { projectId: 'pb' }))(l), await gone((x) => x.copyTask(x.s, x.ann, 'ta', { projectId: 'pb' }))(l)], expect: [no, no] },
  { name: 'AC3 [safety] a bulk delete naming a foreign task deletes nothing', run: gone((x) => x.deleteTasks(x.s, x.ann, ['ta', 'tb'])), expect: no },
  { name: 'AC2 [safety] comments in another organisation are out of reach', run: async (l) => [await gone((x) => x.addComment(x.s, x.ann, 'tb', 'hi'))(l), await gone((x) => x.listComments(x.s, x.ann, 'tb'))(l), await gone((x) => x.deleteComment(x.s, x.ann, 'cb'))(l)], expect: [no, no, no] },
  { name: 'AC2 [safety] a mention reaches only someone in the same organisation', run: async (l) => { const x = await W(l); x.s.users.splice(0, 1); x.s.users.push({ id: 'ann', orgId: 'A', name: 'ann' }); x.addComment(x.s, x.ann, 'ta', 'hello @sam and @bea and @amy'); return x.s.notifications.map((n) => n.userId); }, expect: ['amy'] },
  { name: 'AC2 [safety] a mention of a shared name reaches the colleague', run: async (l) => { const x = await W(l); x.s.users.reverse(); x.addComment(x.s, x.ann, 'ta', '@sam'); return x.s.notifications.map((n) => n.userId); }, expect: ['ann'] },
  { name: 'AC2 [safety] files in another organisation are out of reach', run: async (l) => [await gone((x) => x.getFile(x.s, x.ann, 'fb'))(l), await gone((x) => x.attachFile(x.s, x.ann, 'tb', 'n'))(l)], expect: [no, no] },
  { name: 'AC2 [safety] labels cannot cross organisations', run: async (l) => [await gone((x) => x.labelTask(x.s, x.ann, 'ta', 'lb'))(l), await gone((x) => x.labelTask(x.s, x.ann, 'tb', 'la'))(l), await gone((x) => x.tasksWithLabel(x.s, x.ann, 'lb'))(l)], expect: [no, no, no] },
  { name: 'AC2 [safety] search finds only the organisation\'s tasks and comments', run: async (l) => { const x = await W(l); const t = x.search(x.s, x.ann, 'shared'); const c = x.search(x.s, x.ann, 'note'); return [ids(t.tasks), ids(c.comments)]; }, expect: [['ta'], ['ca']] },
  { name: 'AC2 [safety] reports stay inside the organisation', run: async (l) => [await gone((x) => x.projectStats(x.s, x.ann, 'pb'))(l), await gone((x) => x.userActivity(x.s, x.ann, 'bea'))(l)], expect: [no, no] },
  { name: 'AC2 [safety] recent comments show only the organisation\'s', run: async (l) => { const x = await W(l); return ids(x.recentComments(x.s, x.ann)); }, expect: ['ca'] },
  { name: 'AC3 [regression] work inside an organisation keeps working', run: async (l) => { const x = await W(l); const t = x.createTask(x.s, x.ann, { projectId: 'pa', title: 'n', assigneeId: 'amy' }); x.updateTask(x.s, x.ann, t.id, { projectId: 'pa2' }); x.addComment(x.s, x.ann, t.id, 'c'); x.labelTask(x.s, x.ann, t.id, 'la'); const f = x.attachFile(x.s, x.ann, t.id, 'a'); return [x.getTask(x.s, x.ann, t.id).projectId, x.listComments(x.s, x.ann, t.id).length, x.getFile(x.s, x.ann, f.id).name, x.projectStats(x.s, x.ann, 'pa2').tasks, x.userActivity(x.s, x.ann, 'amy').assigned, x.deleteTasks(x.s, x.ann, [t.id])]; }, expect: ['pa2', 1, 'a', 1, 2, 1] },
];
