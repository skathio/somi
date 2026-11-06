# Conventions

**Lists** answer `{ items, total, nextOffset }`, where `total` counts everything that matches and `nextOffset` is null on the last page. `limit` runs from 1 to 100 and defaults to 20. Newest first.

**Bad parameters** throw `HttpError(400, 'invalid_query', ...)`. Free text is at most 200 characters.

**Text.** Anything a person typed is compared through `normalize` from `src/text.mjs`, so accents, case and surrounding space never matter. Search text is literal and has no special characters. Several words all have to match, in any order, anywhere in the fields being searched. A search with nothing in it is the same as no search.

**Fields.** A note is searched by its title, its body and its tags.
