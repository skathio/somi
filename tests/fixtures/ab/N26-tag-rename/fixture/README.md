# Notes and tags

A note is `{ id, owner, tags }`. `store.tagCounts[user]` maps each tag to how many of that person's notes carry it, for the sidebar, and a tag with no notes has no entry.

Tags are stored normalized by `tagKey`, a note never holds the same tag twice, and tags keep the order they were added in.
