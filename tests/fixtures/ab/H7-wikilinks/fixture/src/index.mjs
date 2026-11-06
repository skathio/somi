import { renderBlocks } from './blocks.mjs';

export { renderInline } from './inline.mjs';

/** Renders a markdown document to an HTML string. Blocks are separated by a newline. */
export function render(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  return renderBlocks(lines).join('\n');
}
