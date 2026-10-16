// The README's first code block and its marked sess.ask() example, read the same way by the
// package check (installed tarball) and the unit test (source). Line endings are normalized first,
// so a CRLF checkout or pack (Windows) selects exactly the same block as an LF one.
export function readmeExamples(text) {
  const readme = text.replace(/\r\n/g, '\n');
  const first = /```ts\n([\s\S]*?)\n```/.exec(readme)?.[1];
  const ask = /<!-- example:ask -->\s*```ts\n([\s\S]*?)\n```\s*<!-- \/example:ask -->/.exec(readme)?.[1];
  return { first, ask };
}
