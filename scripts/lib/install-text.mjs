// install-text.mjs — the install-root text tools: somi_command, somi_skill and somi_agent, each
// serving one file that ships in SoMi's own install directory (commands/<name>.md,
// skills/<name>/SKILL.md, agents/<name>.md). A consuming project can't follow a relative link into
// that directory, so the text is served over the MCP channel instead.
//
// Pure apart from the one file read: the caller supplies the install root and turns {ok, ...} into
// its own surface (the MCP server's textResult and the `<prog>: <message> (exit N)` failure line).

import fs from 'node:fs';
import path from 'node:path';
import { AGENT_NAME_RE, EXIT_USAGE, EXIT_UNKNOWN_AGENT } from './dispatch-resolver.mjs';

export const INSTALL_TEXT_TOOLS = [
  {
    name: 'somi_command',
    description:
      "Read a SoMi command's own procedure text (commands/<name>.md) from the install root, so " +
      'a front door running in a consuming project can follow it live without knowing where SoMi ' +
      'is installed.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'command name, e.g. "plan" (matches ^[a-z][a-z0-9-]*$)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'somi_skill',
    description:
      "Read a SoMi skill's own text (skills/<name>/SKILL.md) from the install root — the same " +
      'problem `somi_command` solves for commands/, applied to skills/: a reference to a skill from ' +
      "a consuming project can't rely on a relative link into SoMi's own install directory, since " +
      "that directory generally isn't the consuming project's own tree. Read the dispatch " +
      'procedure this way (`somi_skill({name: "somi-dispatch"})`) whenever the skill can\'t be ' +
      'loaded by name on the current host (e.g. no Skill tool, or a non-Claude-Code host).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'skill name, e.g. "somi-dispatch" (matches ^[a-z][a-z0-9-]*$)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'somi_agent',
    description:
      "Read a SoMi agent's instructions (agents/<name>.md, frontmatter removed) from the install " +
      'root, to inspect or quote them. Not a way to run the agent: start it as the agent_type ' +
      'somi_resolve returns, never as another agent given this text.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'agent name, e.g. "somi-reviewer" (matches ^[a-z][a-z0-9-]*$)' },
      },
      required: ['name'],
    },
  },
];

const NAME_MAX = 64; // the slug bound; the echo of a refused name is cut as well
const fail = (code, message) => ({ ok: false, code, message });

// The agent's instructions without its frontmatter, for reading. Dispatch never uses this: an agent
// starts as its registered agent_type (see skills/somi-dispatch §5), so the text is never a payload.
const stripFrontmatter = (text) => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trimStart();

const SOURCES = {
  command: { relPath: (n) => ['commands', `${n}.md`], shape: (t) => t },
  skill: { relPath: (n) => ['skills', n, 'SKILL.md'], shape: (t) => t },
  agent: { relPath: (n) => ['agents', `${n}.md`], shape: stripFrontmatter },
};

// One reader for every install-root text tool. The name is checked against AGENT_NAME_RE BEFORE
// any path is built, so a traversal payload (`../x`, `a/b`) is a 64 and never reaches path.join.
// JSON.stringify, not a template interpolation, for the invalid name: an object-shaped `name`
// (e.g. `{toString: null}`) throws inside `${name}` and would surface as an unrelated -32603.
/**
 * @param {'command' | 'skill' | 'agent'} kind
 * @param {{name?: unknown}} args
 * @param {{installRoot: string}} env
 * @returns {{ok: true, text: string} | {ok: false, code: number, message: string}}
 */
export function installText(kind, args, { installRoot }) {
  const name = args?.name;
  if (typeof name !== 'string' || name.length > NAME_MAX || !AGENT_NAME_RE.test(name)) {
    return fail(EXIT_USAGE, `invalid name ${JSON.stringify(name)?.slice(0, 60)} (expected ${AGENT_NAME_RE}, at most ${NAME_MAX} characters)`);
  }
  const { relPath, shape } = SOURCES[kind];
  const filePath = path.join(installRoot, ...relPath(name));
  try {
    return { ok: true, text: shape(fs.readFileSync(filePath, 'utf8')) };
  } catch (e) {
    if (e.code === 'ENOENT') return fail(EXIT_UNKNOWN_AGENT, `unknown ${kind} "${name}" (no ${filePath})`);
    throw e;
  }
}
