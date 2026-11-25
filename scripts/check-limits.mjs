// Sess founder 2026-11-07 01:30Z (one source, everywhere): every Surface text limit the SDK, its
// adapters and their documents state equals the reviewed contract snapshot (contract/openapi.json;
// scripts/surface-limits.mjs reads it). npm run check:contract runs this check. Each limit
// constant in the code (CONSTANTS) must equal the contract, key by key, and a key that is neither
// mapped nor named as not a Surface text limit fails. Prose and doc comments are listed mention
// by mention (FILES), and any other "at most N" in those files fails until it is listed. Adapter
// tool-schema descriptions must read their constant, never a written number (SOURCES). The check
// reads source text only and changes no packed file.
import { readFile } from 'node:fs/promises';
import { deriveLimits } from './surface-limits.mjs';

const L = deriveLimits(JSON.parse(await readFile('contract/openapi.json', 'utf8')));
const n = (v) => v.toLocaleString('en-US');
const S = String.raw;

/**
 * Each file: `rules`, a pattern whose groups are numbers and the limits they must equal; `other`,
 * the "at most N" phrases there that are not Surface text limits (counts, IDs, seconds).
 */
const FILES = {
  'README.md': {
    rules: [
      [S`\| Title \(\`question\`\)\s*\| A question or a task, about (\d+) \| (\d+)`, ['titleGuide', 'title']],
      [S`\| Button \(\`submit_label\`\)\s*\| A verb, 1–3 words\s*\| (\d+)`, ['actionLabel']],
      [S`\| Field label\s*\| Short\s*\| (\d+)`, ['fieldLabel']],
      [S`\| Option\s*\| Short\s*\| (\d+)`, ['optionLabel']],
      [S`\| Help \(field \`description\`\)\s*\| One hint\s*\| (\d+)`, ['fieldDescription']],
      [S`\| Description under the title \| One or two sentences\s*\| (\d+)`, ['description']],
      [S`\| Heading\s*\| Short\s*\| (\d+)`, ['heading']],
      [S`\| Record caption\s*\| A few words\s*\| (\d+)`, ['recordLabel']],
      [S`\| Record key / string value\s*\| As written\s*\| (\d+) / (\d+)`, ['recordKey', 'recordValue']],
      [S`\| Text \(\`details\`\)\s*\| Plain text\s*\| ([\d,]+)`, ['text']],
      [
        S`The title can be at most (\d+) characters\. Keep it\s+to a short heading, about (\d+)\.`,
        ['title', 'titleGuide'],
      ],
      [
        S`the limit is (\d+)\. Shorten it to at most (\d+) characters\." Nothing`,
        ['fieldLabel', 'fieldLabel'],
      ],
      [S`A row name has at most (\d+) characters and its detail at most (\d+)\.`, ['itemName', 'itemDetail']],
    ],
    other: [S`at most 5 buttons`, S`at most twelve lines`],
  },
  'docs/api.md': {
    rules: [
      [S`a \`label\`\s+\(short, 1–(\d+) characters\)`, ['fieldLabel']],
      [S`Each option is 1–(\d+) characters\.`, ['optionLabel']],
      [S`a question or a task, about (\d+) characters, at most\s+(\d+)\), optional`, ['titleGuide', 'title']],
      [S`a verb of 1–3 words, at most (\d+) characters; default`, ['actionLabel']],
      [S`two ends, at most (\d+) characters each`, ['ratingLabel']],
      [S`\| \`title\`\s*\| A question or a task, about (\d+) \| (\d+)`, ['titleGuide', 'title']],
      [S`\| \`description\` \(under the title\)\s*\| One or two sentences\s*\| (\d+)`, ['description']],
      [S`\| \`heading\` component \`text\`\s*\| Short\s*\| (\d+)`, ['heading']],
      [S`\| Field \`label\`\s*\| Short\s*\| (\d+)`, ['fieldLabel']],
      [S`\| \`option_labels\` value, \`ask\` option\s*\| Short\s*\| (\d+)`, ['optionLabel']],
      [S`\| Field \`description\` \(help\)\s*\| One hint\s*\| (\d+)`, ['fieldDescription']],
      [
        S`\| Action \`label\` \(\`ask\`: \`submit_label\`\)\s*\| A verb, 1–3 words\s*\| (\d+)`,
        ['actionLabel'],
      ],
      [S`\| \`record\` \`label\` \(caption\)\s*\| A few words\s*\| (\d+)`, ['recordLabel']],
      [S`\| \`record\` key / string value\s*\| As written\s*\| (\d+) / (\d+)`, ['recordKey', 'recordValue']],
      [S`\| \`text\` component\s*\| Plain text\s*\| ([\d,]+)`, ['text']],
      [
        S`\| Rating end label \(\`rating\.low\`, \`rating\.high\`\)\s*\| A word or two\s*\| (\d+)`,
        ['ratingLabel'],
      ],
      [S`A display Session's title is also at most (\d+) \(the same title message\)`, ['title']],
      [
        S`that ID is held to (\d+) too; a long ID with a short label is fine \(IDs may have up to 200\)\. Over (\d+),`,
        ['optionLabel', 'optionLabel'],
      ],
      [
        S`"The title can be\s+at most (\d+) characters\. Keep it to a short heading, about (\d+)\."`,
        ['title', 'titleGuide'],
      ],
      [
        S`row name (\d+), detail (\d+) \(with the reference\), totals label\s+(\d+), caption (\d+), quantity unit (\d+)`,
        ['itemName', 'itemDetail', 'totalLabel', 'itemsLabel', 'quantityUnit'],
      ],
    ],
    other: [
      S`description stays at most 4,000`,
      S`at most \{limit\}`,
      S`at most 5 actions`,
      S`Send at most 100`,
    ],
  },
  'adapters/mcp/README.md': {
    rules: [
      [
        S`\| Title \(\`title\`, \`sess_ask\` \`question\`\)\s*\| A question or a task, about (\d+) \| (\d+)`,
        ['titleGuide', 'title'],
      ],
      [
        S`\| Button \(action \`label\`, \`submit_label\`\)\s*\| A verb, 1–3 words\s*\| (\d+)`,
        ['actionLabel'],
      ],
      [S`\| Field label\s*\| Short\s*\| (\d+)`, ['fieldLabel']],
      [S`\| Option label, \`sess_ask\` option\s*\| Short\s*\| (\d+)`, ['optionLabel']],
      [S`\| Help \(field \`description\`\)\s*\| One hint\s*\| (\d+)`, ['fieldDescription']],
      [S`\| \`description\` under the title\s*\| One or two sentences\s*\| (\d+)`, ['description']],
      [S`\| \`heading\`\s*\| Short\s*\| (\d+)`, ['heading']],
      [S`\| \`record\` \`label\` \(caption\)\s*\| A few words\s*\| (\d+)`, ['recordLabel']],
      [S`\| \`record\` key / string value\s*\| As written\s*\| (\d+) / (\d+)`, ['recordKey', 'recordValue']],
      [S`\| \`text\`, \`sess_ask\` \`details\`\s*\| Plain text\s*\| ([\d,]+)`, ['text']],
      [S`so that ID is held to (\d+) too`, ['optionLabel']],
      [
        S`"The title can be at most (\d+)\s+characters\. Keep it to a short heading, about (\d+)\."`,
        ['title', 'titleGuide'],
      ],
      [S`the limit is (\d+)\. Shorten it to at most (\d+) characters\.",`, ['fieldLabel', 'fieldLabel']],
      [S`"limit": (\d+),\s+"length": 52`, ['fieldLabel']],
    ],
    other: [S`at most 45 seconds`, S`at most once per`],
  },
  'adapters/openclaw/README.md': {
    rules: [
      [
        S`title (\d+) \(about (\d+) is the\s+style\), description (\d+), heading (\d+), field labels (\d+), option labels (\d+), field description (\d+),\s+action label (\d+), record caption (\d+), record key (\d+) and string value (\d+), text ([\d,]+)`,
        [
          'title',
          'titleGuide',
          'description',
          'heading',
          'fieldLabel',
          'optionLabel',
          'fieldDescription',
          'actionLabel',
          'recordLabel',
          'recordKey',
          'recordValue',
          'text',
        ],
      ],
      [S`so that ID is held to (\d+) too`, ['optionLabel']],
      [
        S`"The title can be at most (\d+) characters\. Keep it to a short heading, about\s+(\d+)\."`,
        ['title', 'titleGuide'],
      ],
    ],
    other: [S`at most 5\s+actions`, S`at most \{limit\}`],
  },
  'adapters/openclaw/skills/sess/SKILL.md': {
    rules: [
      [
        S`a title of about (\d+) characters \(at most (\d+)\), a question or\s+a task; button labels a verb of 1-3 words \(at most (\d+)\); field labels at most (\d+); help one hint\s+\(at most (\d+)\)`,
        ['titleGuide', 'title', 'actionLabel', 'fieldLabel', 'fieldDescription'],
      ],
    ],
    other: [],
  },
  'create-agent/template/README.md': {
    rules: [
      [
        S`about (\d+) characters \(at most (\d+)\);\n- the button: a verb, 1–3 words \(at most (\d+)\);\n- field labels: short \(at most (\d+)\);\n- choices: short \(at most (\d+)\);\n- help under a field: one hint \(at most (\d+)\)`,
        ['titleGuide', 'title', 'actionLabel', 'fieldLabel', 'optionLabel', 'fieldDescription'],
      ],
    ],
    other: [S`retries at most 3 times`],
  },
  'examples/quickstart-node/README.md': {
    rules: [
      [
        S`about (\d+)\s+characters and at most (\d+); a button label is a verb of 1–3 words, at most (\d+); field labels at\s+most (\d+) and options at most (\d+); help at most (\d+)\.`,
        ['titleGuide', 'title', 'actionLabel', 'fieldLabel', 'optionLabel', 'fieldDescription'],
      ],
    ],
    other: [],
  },
  'src/ask.ts': {
    rules: [
      [S`What the field asks for: short, a few words; at most (\d+)\.`, ['fieldLabel']],
      [S`Optional words by the lowest choice: a word or two; at most (\d+)\.`, ['ratingLabel']],
      [S`Optional words by the highest choice: a word or two; at most (\d+)\.`, ['ratingLabel']],
      [
        S`The words shown for one choice: short; at most (\d+)\. Example: \`Next Monday\` \*/\n      readonly options: readonly \[string, \.\.\.string\[\]\];\n      readonly default\?: string;`,
        ['optionLabel'],
      ],
      [
        S`The words shown for one choice: short; at most (\d+)\. Example: \`Next Monday\` \*/\n      readonly options: readonly \[string, \.\.\.string\[\]\];\n      readonly default\?: readonly`,
        ['optionLabel'],
      ],
      [S`a question or a task, about (\d+) characters; at most (\d+)\.`, ['titleGuide', 'title']],
      [S`plain-text context shown above the fields, at most ([\d,]+) characters`, ['text']],
      [S`A button: a verb, 1–3 words; at most (\d+)\.`, ['actionLabel']],
    ],
    other: [S`at most your plan's`],
  },
  'src/types.ts': {
    rules: [
      [
        S`title (\d+), description (\d+), heading (\d+), text (\d+), record\s+\* caption (\d+), row name (\d+), row string value (\d+), field label (\d+), field help (\d+), option label\s+\* (\d+), button (\d+);`,
        [
          'title',
          'description',
          'heading',
          'text',
          'recordLabel',
          'recordKey',
          'recordValue',
          'fieldLabel',
          'fieldDescription',
          'optionLabel',
          'actionLabel',
        ],
      ],
      [S`a question or a task, about (\d+) characters; at most (\d+)\.`, ['titleGuide', 'title']],
      [S`Optional caption: what the list is, a few words; at most (\d+)\.`, ['itemsLabel']],
      [S`What one line is: at most (\d+)\.`, ['itemName']],
      [S`Optional second line: quantity, unit price or a reference; at most (\d+)\.`, ['itemDetail']],
      [S`A label: a word or two; at most (\d+)\.`, ['totalLabel']],
      [S`A section heading: a few words; at most (\d+)\.`, ['heading']],
      [S`what the person needs to know; at most (\d+)\.`, ['text']],
      [S`Optional caption above the record: a few words; at most (\d+)\.`, ['recordLabel']],
      [S`A row's name: a word or two; at most (\d+) \(example`, ['recordKey']],
      [S`A row's value: a string of at most (\d+),`, ['recordValue']],
      [S`What the field asks for: short, a few words; at most (\d+)\.`, ['fieldLabel']],
      [S`Optional help under the label: one hint; at most (\d+)\.`, ['fieldDescription']],
      [S`The words shown for one choice: short; at most (\d+)\.`, ['optionLabel']],
      [S`a word or two; at most (\d+) each\.`, ['ratingLabel']],
      [S`A button: a verb, 1–3 words; at most (\d+)\.`, ['actionLabel']],
      [S`in one or two plain\s+\* sentences; at most (\d+)\.`, ['description']],
    ],
    other: [S`at most 5 actions`, S`at most 256 characters`],
  },
  'src/commerce/builders.ts': {
    rules: [
      [S`The page's heading, about (\d+) characters; at most (\d+)\.`, ['titleGuide', 'title']],
      [S`Optional context under the title, one or two sentences; at most (\d+)\.`, ['description']],
      [S`under its plain name, such as \`Invoice\` → \`INV-2041\`; at most (\d+)\.`, ['recordValue']],
    ],
    other: [],
  },
  'src/commerce/items.ts': {
    rules: [
      [
        S`a row\s+\* name ≤ (\d+), a detail ≤ (\d+), a totals label ≤ (\d+), a caption ≤ (\d+), a quantity unit ≤ (\d+),`,
        ['itemName', 'itemDetail', 'totalLabel', 'itemsLabel', 'quantityUnit'],
      ],
      [S`What the line is, shown verbatim; at most (\d+)\.`, ['itemName']],
      [S`Optional second line: quantity or unit price; at most (\d+) with`, ['itemDetail']],
      [S`A word or two; at most (\d+)\. Examples: \`GST 5%\``, ['totalLabel']],
      [S`A word or two; at most (\d+)\. Example: \`Deposit paid\``, ['totalLabel']],
      [S`Optional caption: what the list is; at most (\d+)\.`, ['itemsLabel']],
    ],
    other: [S`a string of at most \`max\``, S`at most \`max\` code points`],
  },
};

/**
 * Limit constants in code: each file's `Object.freeze({...})` constant, every key mapped to its
 * contract limit, or listed in `not` (counts, depths, IDs and texts nobody reads as written).
 */
const CONSTANTS = {
  'src/ask.ts': {
    name: 'LIMITS',
    map: {
      question: 'title',
      details: 'text',
      submitLabel: 'actionLabel',
      label: 'fieldLabel',
      option: 'optionLabel',
      ratingLabel: 'ratingLabel',
    },
    // textMax bounds the person's text answer, not a text they read.
    not: ['fields', 'options', 'depth', 'textMax'],
  },
  'src/commerce/builders.ts': {
    name: 'LIMITS',
    map: {
      title: 'title',
      description: 'description',
      recordKey: 'recordKey',
      recordValue: 'recordValue',
      actionLabel: 'actionLabel',
    },
    not: ['recordFields', 'actions'],
  },
  'src/commerce/items.ts': {
    name: 'ITEMS_LIMITS',
    map: {
      name: 'itemName',
      detail: 'itemDetail',
      totalLabel: 'totalLabel',
      label: 'itemsLabel',
      quantityUnit: 'quantityUnit',
    },
    not: ['rows', 'totals', 'amount', 'quantity'],
  },
  'adapters/mcp/src/validate.ts': {
    name: 'TEXT_LIMITS',
    map: {
      title: 'title',
      description: 'description',
      heading: 'heading',
      text: 'text',
      label: 'fieldLabel',
      optionLabel: 'optionLabel',
      help: 'fieldDescription',
      actionLabel: 'actionLabel',
      recordLabel: 'recordLabel',
      recordKey: 'recordKey',
      recordValue: 'recordValue',
      ratingLabel: 'ratingLabel',
    },
    not: ['enumValue', 'schemaTitle', 'schemaDescription'],
  },
  'adapters/openclaw/src/schemas.ts': {
    name: 'TEXT_LIMITS',
    map: {
      title: 'title',
      description: 'description',
      heading: 'heading',
      text: 'text',
      label: 'fieldLabel',
      optionLabel: 'optionLabel',
      help: 'fieldDescription',
      actionLabel: 'actionLabel',
      recordLabel: 'recordLabel',
      recordKey: 'recordKey',
      recordValue: 'recordValue',
    },
    not: ['schemaTitle', 'schemaDescription', 'enumValue'],
  },
};

const problems = [];
let checked = 0;
for (const [file, { name, map, not }] of Object.entries(CONSTANTS)) {
  const text = await readFile(file, 'utf8');
  const start = new RegExp(S`\bconst ${name} = Object\.freeze\(\{`).exec(text);
  if (!start) {
    problems.push(`${file}: no "const ${name} = Object.freeze({"`);
    continue;
  }
  const from = start.index + start[0].length;
  const body = text.slice(from, text.indexOf('});', from));
  const line = (at) => text.slice(0, from + at).split('\n').length;
  const seen = new Set();
  for (const m of body.matchAll(/^\s*(\w+):\s*([^,\n]+),/gm)) {
    const [, key, value] = m;
    seen.add(key);
    if (not.includes(key)) continue;
    if (!(key in map)) {
      problems.push(`${file}:${line(m.index)}: ${name}.${key} is not mapped to a contract limit`);
      continue;
    }
    checked++;
    const said = Number(value.replace(/_/g, ''));
    if (said !== L[map[key]])
      problems.push(`${file}:${line(m.index)}: ${name}.${key} is ${value}, the contract says ${L[map[key]]}`);
  }
  for (const key of Object.keys(map)) if (!seen.has(key)) problems.push(`${file}: ${name}.${key} not found`);
}

for (const [file, { rules, other }] of Object.entries(FILES)) {
  const text = await readFile(file, 'utf8');
  const covered = new Set();
  for (const [source, keys] of rules) {
    const re = new RegExp(source, 'g');
    const matches = [...text.matchAll(re)];
    if (matches.length === 0) problems.push(`${file}: no mention matches /${source}/`);
    for (const m of matches) {
      keys.forEach((key, i) => {
        const said = Number((m[i + 1] ?? '').replace(/,/g, ''));
        checked++;
        if (said !== L[key])
          problems.push(`${file}: says ${m[i + 1]} for ${key}, the contract says ${n(L[key])}`);
      });
      for (let at = m.index; at < m.index + m[0].length; at++) covered.add(at);
    }
  }
  // Every other "at most N" must be listed as not a Surface text limit.
  const allowed = other.flatMap((o) => [...text.matchAll(new RegExp(o, 'g'))].map((m) => m.index));
  for (const m of text.matchAll(/at most\s+(\d[\d,]*)/g)) {
    if (covered.has(m.index)) continue;
    if (allowed.some((a) => a <= m.index && m.index < a + 40)) continue;
    const line = text.slice(0, m.index).split('\n').length;
    problems.push(`${file}:${line}: "${m[0]}" is not a listed limit mention (scripts/check-limits.mjs)`);
  }
}

/**
 * Adapter tool schemas an agent reads: each description that states a limit must take it from the
 * adapter's TEXT_LIMITS (the expression named here), never a written number.
 */
const SOURCES = {
  'adapters/mcp/src/tools.ts': [
    [S`so it is then held to (?:(\d[\d,]*)|\$\{([^}]*)\}) characters too`, 'L.optionLabel'],
  ],
  'adapters/openclaw/src/schemas.ts': [
    [S`so it is then held to (?:(\d[\d,]*)|\$\{([^}]*)\}) characters too`, 'TEXT_LIMITS.optionLabel'],
  ],
};
for (const [file, rules] of Object.entries(SOURCES)) {
  const text = await readFile(file, 'utf8');
  for (const [source, expression] of rules) {
    const matches = [...text.matchAll(new RegExp(source, 'g'))];
    if (matches.length === 0) problems.push(`${file}: no description matches /${source}/`);
    for (const m of matches) {
      checked++;
      const line = text.slice(0, m.index).split('\n').length;
      if (m[1] !== undefined)
        problems.push(
          `${file}:${line}: writes ${m[1]}; take it from \${${expression}} (the checked TEXT_LIMITS)`,
        );
      else if (m[2].trim() !== expression)
        problems.push(`${file}:${line}: reads \${${m[2]}}, expected \${${expression}}`);
    }
  }
}

if (problems.length) {
  for (const p of problems) console.error(`check:limits: ${p}`);
  process.exit(1);
}
console.log(
  `Limits verified: ${checked} constants and mentions in ${new Set([...Object.keys(CONSTANTS), ...Object.keys(FILES), ...Object.keys(SOURCES)]).size} files equal the contract (title ${L.title}, description ${L.description}, field label ${L.fieldLabel}, option ${L.optionLabel}, button ${L.actionLabel}).`,
);
