#!/usr/bin/env bash
# Builds the Pages folder site/dist: the overview page at its root (served at /somi/) and the
# VitePress docs site under docs/ (served at /somi/docs/), built from the repo's docs/*.md,
# which it reads and never edits. Run from the repo root after `npm --prefix site ci
# --ignore-scripts` and `npm --prefix docs-site ci --ignore-scripts`. site.yml uploads
# site/dist and ci.yml runs this same script on every pull request. Nothing generated is
# committed: the docs are staged and built under artifacts/.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$here")"
stage="$root/artifacts/docs-site"
pages="$root/site/dist"

if [[ ! -d "$here/node_modules/vitepress" ]]; then
  echo "docs-site/node_modules/vitepress is missing: run 'npm --prefix docs-site ci --ignore-scripts' first." >&2
  exit 1
fi

if [[ ! -d "$root/site/node_modules" ]]; then
  echo "site/node_modules is missing: run 'npm --prefix site ci --ignore-scripts' first." >&2
  exit 1
fi

# getting-started.md is published as the docs site's index page (`rewrites` in config.mts), so a
# docs/index.md would be written to the same file: fail instead of letting one replace the other.
if [[ -e "$root/docs/index.md" ]]; then
  echo "docs/index.md exists and would collide with getting-started.md, the docs home page: rename it." >&2
  exit 1
fi

# The Pages folder of an earlier run goes first, so a build that fails leaves no stale site
# behind for site.yml to pick up.
rm -rf "$stage" "$pages"

# From here on site/dist is being filled. Whatever stops the script before the docs are in it
# removes it, so an upload never finds the overview page alone or half a site.
finished=0
trap '[[ "$finished" == 1 ]] || rm -rf "$pages"' EXIT

# The overview page first: Vite empties site/dist, so the docs can only be copied in after it.
# Its log goes to stdout, so stderr holds only this script's own refusals. A build that fails
# after Vite wrote the page (its check-dist, say) would otherwise leave that page behind.
if ! npm --prefix "$root/site" run build 2>&1; then
  echo "the overview page's build failed: site/dist was removed." >&2
  exit 1
fi

# The docs live under the overview page's docs/ route, so its build must not emit a docs entry
# of its own (from site/public/docs, say): copying over it would mix the two, so fail instead.
if [[ -e "$pages/docs" ]]; then
  rm -rf "$pages"
  echo "site/dist/docs exists after the overview page's build and would collide with the docs route: remove site/public/docs." >&2
  exit 1
fi

# VitePress reads one source folder and resolves node modules from the sources, so the
# pages and the logo are staged together next to a link to docs-site's node_modules.
mkdir -p "$stage/src/public"
cp "$root"/docs/*.md "$stage/src/"
cp "$root/site/brand/somi-mark.svg" "$stage/src/public/somi-mark.svg"
ln -s "$here/node_modules" "$stage/node_modules"

# A failed docs build would leave the overview page alone in site/dist, a Pages folder an
# upload could still pick up: remove it before failing.
if ! node "$here/node_modules/vitepress/bin/vitepress.js" build "$here"; then
  rm -rf "$pages"
  echo "the VitePress build failed: site/dist was removed." >&2
  exit 1
fi

cp -R "$stage/dist" "$pages/docs"
finished=1
