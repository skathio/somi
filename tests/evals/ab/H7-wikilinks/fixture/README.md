# mdlite

A small markdown-to-HTML renderer for the team wiki. Use it as a library: `import { render } from './src/index.mjs'`;
`render(markdown)` returns an HTML string. Run the tests with `npm test`.

## What it understands

- Blocks: paragraphs (separated by blank lines), headings (`#` to `######`), bullet lists (`-`, `*` or `+`, one line
  per item) and fenced code blocks (three backticks, an optional language).
- Inline: `*em*` or `_em_`, `**strong**` or `__strong__`, `` `code` `` and `[text](target)` links.
- Soft line breaks inside a paragraph are kept as a newline in the HTML.

## Conventions

- **Escaping.** The whole input is HTML-escaped once, up front (`& < > " '`), and only then is markup recognised.
  Raw HTML never passes through, and every piece of markup works on escaped text: `a & b` is already `a &amp; b`
  when a rule sees it. Output built from a rule's captured text must not be escaped a second time.
- **Code is literal.** The text of a code span or a fenced block is shown as typed (escaped), never interpreted.
  A code span is text between single backticks on one line.
- **Links.** The text of `[text](target)` is formatted like any other text (emphasis, code). A target must start with
  `http://`, `https://`, `mailto:`, `/` or `#`; for any other target only the text is rendered, with no link.
  Links to other sites (`http`, `https`) carry `rel="noopener"`; links on this site do not.
- **Emphasis.** Markers must hug the text (`2 * 3 * 4` is not emphasis). Emphasis can wrap a link, and the markers
  inside a link's target or text are not emphasis for the surrounding text.
- **Finished pieces are parked.** A rule that has produced finished HTML (code, a link) parks it behind a token so
  that later rules cannot change it; the tokens are put back at the end of `renderInline`.
- **Brackets never nest.** The text of a construct cannot contain `[` or `]`: in `[a [b](/x)` only `b` is a link and
  the rest is shown as typed. An opening bracket that is never closed is just text.
- **Addresses.** An address the renderer writes into `href` is plain ASCII. Text that is turned into an address
  part is percent-encoded so that decoding the part gives back exactly the typed text, and a character such as
  `/`, `?`, `#`, `&`, `%`, a quote or a space in it can never change where the address goes or break out of the attribute.
- **Failure.** Markup that does not form a valid construct is shown as typed. The renderer never throws, whatever
  text it is given (lone surrogates and control characters included).
- **Size.** Documents of up to 1 MB are supported; a 200 KB document renders in well under a second, so no rule may
  take more than linear time on long runs of unclosed or repeated markers.
