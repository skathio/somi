#!/usr/bin/env node
// dispatch-reference-gate.mjs — asserts that every commands/*.md file which starts a real agent
// (a `Task` call naming one of the files under agents/) references skills/somi-dispatch/SKILL.md
// somewhere in its own text -- every entry path that starts an agent resolves it through the same
// dispatch procedure, not just the front door. "Starts an agent" is DERIVED from the real
// agent basenames under agents/ against the handful of call-site shapes this repo's commands
// actually use — never a hand-typed list of command names, which is exactly the kind of second
// copy that drifts (the same reasoning behind the cost-model / digest-marker derivations
// elsewhere in this test suite).
//
// A router command (`/ship`, `/ship-loop`, `/code-parallel`, `/somi`) Tasks other COMMANDS
// (`Task /code-loop`, …), never an agent directly, so none of the call-site patterns below match
// it and it is correctly excluded — verified empirically against the real repo, not assumed.
//
// Usage: node dispatch-reference-gate.mjs <commandsDir> <agentsDir>
// Exit 0 with "ok ..." on stdout when every agent-starting command references the skill.
// Exit 1 with one "MISSING DISPATCH REFERENCE: ..." line per violation otherwise.

import fs from 'node:fs';
import path from 'node:path';

// A reference must carry the LITERAL skill path or the LITERAL tool name -- a bare "somi-dispatch"
// substring match (the marker this file used before) is also satisfied by a mention of
// scripts/somi-dispatch.mjs (the CLI fallback), which references nothing about the RESOLVE
// procedure at all. Case-insensitive: a reference reading "the Somi-Dispatch skill" is still a
// real reference, and the point of this gate is catching a MISSING one, not policing casing.
export const DISPATCH_REFERENCE_RE = /skills\/somi-dispatch\b|\bsomi_resolve\b/i;

// The real call-site shapes this repo's commands/*.md use to start an agent, templated per real
// agent name. Matched against the RAW file text (not word-by-word), case-insensitively (a
// call-site verb at the start of a sentence or a bullet can be lowercased by surrounding prose
// without changing what it does), so a name mentioned only in passing prose (e.g. ".somi/atlas.md"
// as an artifact, or "/impact" as a command name) does not falsely count as "starts an agent" --
// only these concrete call-site idioms do.
function callSitePatterns(name) {
  const n = name.replace(/-/g, '\\-');
  const verbs = 'Brief|Task|Invoke|Start|Spawn|Dispatch|Run';
  return [
    `(?:${verbs})\\s+the\\s+\`${n}\`\\s+agent`, // Brief the `atlas` agent / Run the `atlas` agent
    `(?:${verbs})\\s+the\\s+\\[\`${n}\`\\]`, // Task the [`reviewer`](../agents/reviewer.md)
    `(?:${verbs})\\s+\\[\`${n}\`\\]`, // Task [`architecture-reviewer`](../agents/architecture-reviewer.md)
    `(?:${verbs})\\s+\\[\`agents/${n}\\.md\`\\]`, // Brief [`agents/designer.md`](../agents/designer.md)
    `Task\\s+${n}\\s*\\(`, // Task coder ( = ... )
  ];
}

// Returns the first real agent name whose call-site pattern matches this command's text, or null.
export function agentStartedBy(commandText, agentNames) {
  for (const name of agentNames) {
    for (const pattern of callSitePatterns(name)) {
      if (new RegExp(pattern, 'i').test(commandText)) return name;
    }
  }
  return null;
}

export function agentNamesFrom(agentsDir) {
  return fs
    .readdirSync(agentsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    // agents/somi.md is the front door itself -- no command ever Tasks it (it's a selectable
    // Copilot persona, not a dispatch target), so including it would only ever add noise.
    .filter((n) => n !== 'somi');
}

export function scan(commandsDir, agentsDir) {
  const agentNames = agentNamesFrom(agentsDir);
  const files = fs
    .readdirSync(commandsDir)
    .filter((f) => f.endsWith('.md'))
    .sort();

  const checked = [];
  const missing = [];
  for (const file of files) {
    const full = path.join(commandsDir, file);
    const text = fs.readFileSync(full, 'utf8');
    const startedAgent = agentStartedBy(text, agentNames);
    if (!startedAgent) continue;
    checked.push(file);
    if (!DISPATCH_REFERENCE_RE.test(text)) {
      missing.push({ file, agent: startedAgent });
    }
  }
  return { checked, missing };
}

function main() {
  const [, , commandsDir, agentsDir] = process.argv;
  if (!commandsDir || !agentsDir) {
    console.error('usage: dispatch-reference-gate.mjs <commandsDir> <agentsDir>');
    process.exit(2);
  }
  const { checked, missing } = scan(commandsDir, agentsDir);
  if (missing.length > 0) {
    for (const m of missing) {
      console.log(
        `MISSING DISPATCH REFERENCE: ${m.file} starts the '${m.agent}' agent but never names ` +
          `skills/somi-dispatch or somi_resolve`,
      );
    }
    process.exit(1);
  }
  console.log(`ok (${checked.length} command(s) start an agent; all reference somi-dispatch)`);
}

// Only run as a CLI when invoked directly -- tests/scripts/dispatch-reference-gate.sh imports the
// functions above instead, to exercise them against synthetic fixtures.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
