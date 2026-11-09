// routes.mjs: the deterministic half of routing. It classifies what the work is, never how big it will be, because model size forecasts
// were 2 to 8 times too high. A request in a clear form gets one route. Anything else goes to the coordinator to choose from a short
// table, which spends one turn and no extra agent. Rules alone are not enough: they scored 96% on the phrasings they were written
// beside and 41% on fresh ones, because people describe a problem without naming its kind. Pure, and scored in the benchmark.

// Checked first, in order: when one of these applies it decides, whatever else the request mentions.
const FIRST = [
  ['status', /^\s*(status|what('s| is) (in flight|open|running))\b/i],
  ['resume', /^\s*(continue|resume|pick up|carry on)\b/i],
  ['config', /\bsomi\b.*\b(config|tiers?|model map)\b|\b(tier|model) map\b/i],
  ['incident', /\b(outage|incident|sev[ -]?[012]\b|on fire)\b|\b(prod|production|site|service)\b.{0,30}\b(is |are )?(down|broken|failing|on fire)\b/i],
  ['security-review', /\b(security|threat|vulnerabilit\w*|pentest|owasp)\b.{0,40}\b(review|audit|check|assess\w*|look)\b|\b(review|audit|check|assess)\b.{0,40}\b(security|vulnerabilit\w*|threats?)\b/i],
  ['accessibility', /\b(accessib\w*|a11y|wcag|screen ?readers?|aria)\b/i],
];

// A spec says what a feature returns, so "error" alone is not a symptom, and "keeps working exactly as it does" is a guard, not a refactor.
// A bug is reported by its symptom, often with a guess at the cause, so the guess and the symptom are what it is known by.
const DEBUG = new RegExp([
  String.raw`\b(bug|broken|fails?|failing|failure|crash\w*|exception|regression|stack ?trace|doesn'?t work|not working|flaky|wrong (result|output|value|total)s?)\b|\bfix(es|ing)?\b`,
  String.raw`\b(getting|seeing|see|saw|hitting|threw|keeps (throwing|showing|returning)) (an? |the |this |that )?([\w-]+ )?errors?\b|\berrors? (when|whenever|after|since|in (prod|production|the logs))\b`,
  String.raw`\b(find|track down|work out) (the |its )?(real |root |actual )?causes?\b|\broot cause\b|\bsomeone (thinks|suspects|says|proposes|blames|believes)\b|\bis (at fault|to blame)\b`,
  String.raw`\b(at random|now and then|every so often|from run to run|intermittent\w*|sporadic\w*)\b|\b(at|for) the wrong (hour|time|day|week|month|price|amount|total|place|person|user|customer)s?\b`,
  String.raw`\b(comes?|came|goes|go|went) out (wrong|differently|different)\b|\bdisagree\w*\b|\b(charged|billed|sent|counted) twice\b|\b(lose|loses|losing) (\w+ )?(orders|data|records|rows|messages|events|money|items)\b`,
].join('|'), 'i');
// A refactor is asked for by what is wrong with the shape, or by behaviour that must not move while the code does.
const REFACTOR = new RegExp([
  String.raw`\b(refactor\w*|clean ?up|tidy|untangle|simplify|decouple|extract|dedupe|deduplicate|rename|restructur\w*)\b`,
  String.raw`\b(nearly|almost) (the same|identical)\b|\bduplicat\w+\b|\b(has )?grown into\b|\bkeeps growing\b|\bhard to (change|read|follow|maintain|test)\b|\bnobody dares\b`,
  String.raw`\bmove (the |its )?\w+( \w+)? into\b|\bsplit (it|this|them|the \w+) into\b|\b(stays?|remains?) exactly (the same|as)\b|\bevery (caller|answer|result)\b[^.]{0,60}\bexactly\b`,
].join('|'), 'i');

// Work kinds. One match decides; several conflicting matches go to the coordinator.
const KINDS = [
  ['review', /^\s*(please |can you |could you )?(review|audit|assess|critique)\b|\bcode review\b|\breview (this|the|my|pr|#)|\bis this (ok|okay|right|safe|correct)\b/i],
  ['ship', /\b(ship it|ship this|cut a release|open (a |the )?(pr|pull request)|prepare (a |the )?(release|pr|pull request)|ready to merge|release notes)\b/i],
  ['upgrade', /\b(upgrade|bump|update)\b.{0,40}\b(dependenc\w*|version|package|library|framework|sdk|to v?\d)\b|\bdependabot\b|\bupgrade\b/i],
  ['migrate', /\b(migrat\w*|schema change|backfill|move .{1,40} from .{1,40} to)\b/i],
  ['perf', /\b(too slow|slow|performance|latency|optimi[sz]e|speed up|memory (leak|usage)|profil(ing|er)|throughput|n\+1)\b|\bprofile (it|this|the (code|app|service|query))\b/i],
  ['refactor', REFACTOR],
  ['debug', DEBUG],
  ['discover', /\b(new product|greenfield|product idea|idea for a|competitors?|market research)\b/i],
  ['design', /\b(design|architecture|how should we|adr|trade-?offs?|rfc|which approach|options for)\b/i],
  ['atlas', /\b(map (the|this)|codebase overview|onboard\w*|atlas|blast radius|impact of)\b/i],
  ['plan', /\b(plan (for|this|out|the|first)|roadmap|break (this|it) down|milestones?|epic)\b/i],
];

// "Support keeps seeing" names the support team, not a feature to support.
const NEW_WORK = /^\s*(please )?(add|implement|create|support(?!\s+(team|staff|keeps|says|reports|sees|saw|tells|told|noticed)\b)|allow|let|show|make|write|build|send|store|translate|change|enable)\b/i;
// A ticket that asks for new behaviour in any sentence is not a bug report, however it describes what the feature handles.
const ASKS_NEW = /(^|[.!?:]\s+)(please )?(add|implement|create|allow|build|write)\b/i;
// A long ticket lists its own milestones and decisions, so plan and design words in it are structure. By WHEN, it is still build.
const LONG_SKIPS = new Set(['plan', 'design', 'discover', 'atlas']);
const TICKET_KEY = /^\s*[A-Z][A-Z0-9]+-\d+\s*$/;
const ANSWER = /\?\s*$|^\s*(what|why|how|where|when|who|which|does|do|is|are|can|explain|show me|list)\b/i;
const TICKET_TYPES = Object.freeze({ bug: 'debug', defect: 'debug', incident: 'incident', epic: 'plan', spike: 'design', story: 'build', task: 'build', feature: 'build', improvement: 'build' });

export const ROUTE_NAMES = Object.freeze([...new Set([...FIRST, ...KINDS].map(([r]) => r)), 'answer', 'build']);

// What the coordinator reads when it has to choose. Short, because it is read on the session's model.
export const LONG_REQUEST = 600;
export const WHEN = Object.freeze({
  build: 'a new or changed feature, or anything clear, even a long ticket of many steps: the worker splits it if it proves too big',
  debug: 'something behaves wrongly, and the cause is not known',
  refactor: 'change structure and keep behaviour',
  upgrade: 'move a dependency or runtime to another version',
  migrate: 'change the shape of data already in use',
  perf: 'make something faster or smaller',
  incident: 'production is hurting right now',
  accessibility: 'make an interface usable by everyone',
  plan: 'the maintainer asks to see a plan first, or the order of the work needs approving',
  design: 'settle an expensive-to-reverse choice',
  discover: 'test a new product idea',
  atlas: 'map the code or a change\'s blast radius',
  answer: 'a question, with nothing to change',
  review: 'judge existing changes',
  'security-review': 'judge changes for security',
  ship: 'prepare a release or pull request',
});


// "Add retries for the usual error" asks for new behaviour: there is no bug to reproduce.
function matchedKinds(text, opening, long) {
  const newWork = NEW_WORK.test(text) || ASKS_NEW.test(opening);
  return KINDS.filter(([route, re]) => !(long && LONG_SKIPS.has(route)) && re.test(opening) && !(route === 'debug' && newWork)).map(([route]) => route);
}

export function classify({ request = '', ticket, hint } = {}) {
  if (typeof hint === 'string' && ROUTE_NAMES.includes(hint)) return { route: hint, via: 'hint' };
  const type = String(ticket?.type ?? '').trim().toLowerCase();
  if (Object.hasOwn(TICKET_TYPES, type)) return { route: TICKET_TYPES[type], via: 'ticket' };
  const text = String(request);
  // A long ticket contains words like "fails", "incident" and "milestone" without being about them, so only its opening line can decide.
  // A ticket opens with what it is about: "Bug report", a symptom, or the shape that needs changing.
  const long = text.length > LONG_REQUEST;
  const opening = long ? text.split('\n').find((l) => l.trim() !== '').slice(0, 200) : text;
  for (const [route, re] of FIRST) if (re.test(opening)) return { route, via: 'rule' };
  const matched = matchedKinds(text, opening, long);
  if (matched.length === 1) return { route: matched[0], via: 'rule' };
  if (matched.length > 1) return { route: null, via: 'choose', choices: matched };
  return long ? { route: null, via: 'choose', choices: Object.keys(WHEN) } : unmatched(text);
}

// A request opening with a question word is asking something, unless it clearly names work to do.
function unmatched(text) {
  if (ANSWER.test(text)) return { route: 'answer', via: 'rule' };
  if (NEW_WORK.test(text) || TICKET_KEY.test(text)) return { route: 'build', via: 'rule' };
  return { route: null, via: 'choose', choices: Object.keys(WHEN) };
}
