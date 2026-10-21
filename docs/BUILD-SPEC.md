# Build spec: interactive knowledge-graph course

Self-contained, offline, single-file web app that teaches knowledge-graph construction
through graded items with correction-on-error. This document is the work order. If the
data file and this document disagree about content, the data file wins.

## Deliverable

`dist/knowledge-graphs-course.html` — ONE file, no network requests, no CDN, no external
fonts, opens by double-click on macOS and renders the full course. Built from sources in
`src/` by `node build.mjs`.

Layout:

```
kg-course/
  src/data.json            course content (DO NOT EDIT except where this spec says)
  src/grader.js            pure grading engine, no DOM
  src/app.js               DOM app, reads window.KGGrader
  src/styles.css           all styling
  src/index.template.html  shell with __DATA__, __STYLES__, __GRADER__, __APP__ tokens
  build.mjs                inlines the sources into dist/
  test/grader.test.cjs     node --test suite for the grader
  package.json             {"scripts":{"test":"node --test test/","build":"node build.mjs"}}
  docs/BUILD-SPEC.md       this file
```

No npm dependencies. Node 20+ stdlib only.

## Content contract (src/data.json)

```
course: { title, subtitle, note, source, howto: [string] }
phases: [{ id, label, note }]
modules: [{
  id, num, title, kicker, goal, phase, weeks,
  lesson: [{t:"p"|"h"|"ul"|"code"|"note", x: string | [string]}],
  text?: {title, body},              // sample passage, shown in a distinct panel
  instructions: [string],            // MUST render BEFORE the graded items
  exercises: [ <exercise> ]
}]
```

`module.phase` matches one of `phases[].id`. `module.weeks` is a short label such as
`Weeks 3-4`. Both must be rendered (see UI contract), because the course is a phased
curriculum and a flat module list loses that structure.


Exercise shapes (exactly these fields, exactly these type names):

- `mcq`: `prompt`, `options:[5 or fewer strings]`, `answer:int`, `why:string`, `wrong:[string]`
  (`wrong[i]` is the correction for option i; the entry for the correct index is `""`).
- `multi`: `prompt`, `options:[string]`, `answers:[int]`, `notes:[string]` (one per option),
  `why:string`.
- `triples`: `prompt`, `format:string`, `example:string`, `expected:[{s:[alias],p:[alias],o:[alias]}]`,
  `why:string`, `hint?:string`.
- `categorize`: `prompt`, `buckets:[string]`, `items:[{text,bucket:int,note}]`, `why:string`.
- `order`: `prompt`, `items:[string]` (in CORRECT order), `why:string`.
- `cloze`: `prompt`, `sentence` (contains `______` once), `blanks:[{accept:[string],note}]`,
  `why:string`.
- `numeric`: `prompt`, `answer:number`, `tolerance:number`, `why:string`, `hint?:string`.

Every exercise has `id`. Never invent exercise content: render what the data says.

## Grading contract (src/grader.js)

Export a factory used as `window.KGGrader` in the browser and `require()`-able in Node.
Shape: UMD wrapper, single file, no imports.

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KGGrader = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () { ... return api; });
```

API:

```
normalize(str) -> string
grade(exercise, answer) -> {score: number, max: number, verdict: 'correct'|'partial'|'wrong',
                            why: string, lines: [string], detail: object}
```

`score` is 0..1 rounded to 2 decimals. `max` is informational (1). `lines` are ready-to-render
plain-text correction lines (no HTML), produced by the grader.

`normalize(str)`:
1. `String(str)`, Unicode NFD, strip combining marks (so `Niš` -> `nis`).
2. lowercase, replace `[_-]+` with a space.
3. drop every character that is not a letter, digit, space, or `%`.
4. collapse whitespace, trim, strip a single leading `the `.

Per type:

- **mcq**: `answer` is an option index. score 1 if equal else 0. On wrong: `lines` include
  `wrong[index]` when non-empty, plus `why`. On right: `why`.
- **multi**: `answer` is an array of selected indices. `hits = |selected ∩ answers|`,
  `extra = |selected \ answers|`, `missed = answers \ selected`.
  `score = max(0, hits - extra) / answers.length` (round 2dp).
  `lines`: for each missed option `"Missed: <option text>"`; for each extra
  `"Wrongly included: <option text>"`; each followed by that option's `notes[i]`.
- **triples**: `answer` is the raw textarea string. Parse into lines: split `/\r?\n/`,
  trim, drop blanks and `#` comments, then split on `/\s*\|\s*/` (also accept a single tab as
  separator). Anything that does not yield exactly 3 non-empty parts is a parse error, reported
  as `"Line N is not subject | predicate | object"` and counted as an extra line.
  Matching is greedy, expected order first: an expected triple matches the first unused input
  line whose `normalize(s)` is in the normalized `s` aliases AND same for `p` and `o`.
  `score = max(0, (matched - 0.5 * (inputLines - matched)) / expected.length)`, 2dp.
  `lines` on less than full score: `"Missing: <s> | <p> | <o>"` using each expected tuple's
  FIRST alias, then `"Not in the source: <raw line>"` for each unmatched line.
  `detail` carries `{matched, expected: n, parsed: [[s,p,o],...], missing:[...], extra:[...]}`.
- **categorize**: `answer` is `{itemIndex: bucketIndex}`. `score = correctItems / items.length`.
  `lines` on less than full score, one per wrong item:
  `"<item text>: you chose <bucket>, correct is <bucket>"` then `item.note`.
- **order**: `answer` is an array of item indices in the user's order. score 1 only if the
  sequence equals `[0..n-1]`. On wrong, `lines` = `"Correct order: 1) ... 2) ..."`.
- **cloze**: `answer` is an array of strings, one per blank. A blank is correct when
  `normalize(value)` equals `normalize(a)` for some `a` in `accept`. Also accept when a
  normalized accepted value contains the normalized input and the input is at least 4 chars
  long (so `missed merge` accepts `merge`). `score = correctBlanks / blanks.length`.
  `lines` on less than full score: `"Blank N: you wrote '<value>'. Accepted: <first accept>.<note>"`
- **numeric**: `answer` is the raw string. Strip `%`, commas and spaces; parse float.
  If the parsed value is greater than 1, divide by 100 (percent form). Correct when
  `|v - expected| <= tolerance`. score 1 or 0.

Unsupported type: throw `new Error('unknown exercise type: ' + type)`.

## Persistence

`localStorage` key `kg-course-v1`, wrapped in try/catch; if unavailable, run in memory and
show a one-line notice in the rail footer (`Progress will not persist here`).

```
{ v:1, rec: { [exerciseId]: {best:number, attempts:number, last:number} },
  log: [ {id, score, given, at} ], theme: 'dark'|'light' }
```

`best` only ever increases. `log` appends on every non-perfect attempt, capped at 200 newest.
Export downloads `kg-course-progress.json`; import accepts that file and replaces state after
a confirm.

## UI contract

Full-page app, `<html data-theme="dark">` by default, toggle button in the header that flips
`data-theme` and persists the choice. All colours from CSS variables defined once in
`:root` and overridden in `:root[data-theme="light"]`. No colour literals in markup or JS.

Structure: header (brand, course title, mastery readout, theme toggle) then a two-column
shell: rail (260px) + panel. Below 900px the rail becomes a horizontal scrolling strip and
the shell is one column. Nothing may use `height:100vh`; use natural flow and `min-height`
so the page survives a short viewport without collapsing.

Rail:

- "Overview" entry, then the modules GROUPED BY PHASE: a phase header (label plus note,
  small caps, not clickable) followed by that phase's module entries. The grouping must come
  from `module.phase`, never from array order assumptions.
- One entry per module: two-digit number, title, and a mastery meter made of 8 segments
  (`.on` for filled). Mastery = mean of `best` over that module's exercises, rounded to the
  nearest 1/8 for the meter and shown as a percentage.
- Then "Review (n)" where n = exercises with best < 1, and "Error log (n)".
- Footer: export, import, reset (reset asks for confirmation).
- Current view highlighted with `aria-current="page"`.

Overview view:

- Course title and subtitle.
- "How this works" list from `course.howto`.
- Stats row: items solved out of the total exercise count (computed from the data, never
  hardcoded), mean mastery %, items attempted, weakest part.
- "Source" line: `course.source` as plain text, small.
- Module cards grouped under their phase headings: number, title, kicker, goal, mastery %,
  "Open" button. Card shows "Not started" when attempts are 0.

Module view, top to bottom:

1. `kicker` (small label), `title` (h1), `goal` (subline), and a meta line showing the phase
   label plus `weeks`.
2. Lesson blocks by type: `p` paragraph, `h` h2, `ul` list, `code` pre with copy button,
   `note` callout.
3. Sample text panel when `text` exists: labelled "Sample text", monospace body, visually
   distinct (left border, tinted background).
4. **Instructions panel, mandatory and before the items**: heading "Instructions",
   numbered list of `instructions`. Distinct surface from both lesson and items. This block
   must never appear below the first exercise.
5. Exercise cards, numbered "Item 1 of 4" ... Each card contains the prompt, the input
   control, and a Check button (label: "Check").
6. After the last item: a completion strip showing part mastery and a "Next part" button
   when a next module exists.

Input controls per type:

- mcq: option rows as buttons. Click answers and locks the card immediately.
- multi: checkbox rows + Check button.
- triples: monospace textarea, 6 rows, placeholder from `format`, a hint line with `example`.
- categorize: each item row has one button per bucket; selected bucket is visibly active;
  then Check.
- order: a pool of step buttons and a numbered sequence area. Click a pool step to append,
  click a sequenced step to remove. Then Check.
- cloze: the `sentence` with the blank rendered as an inline input. Check.
- numeric: single-line input with `inputmode="decimal"`. Check.

Feedback (the point of the app): below the control, replace nothing, append a panel with
`role="status"`:

- verdict bar: "Correct", "Partly right", or "Not right yet", plus the score as n%.
- the `why` text, then each grader `line` as its own paragraph with a small left marker.
- a "Try again" button when score < 1 (resets that card only), and a "Show answer" for
  triples and cloze (reveals the first accepted answers; it does not score).
- a correct card gets a quiet confirmation, not confetti.

When a card is graded, persist `best`/`attempts`/`last`, append to the log if score < 1,
and re-render the rail so the mastery meter moves without a page reload.

Review view: list items with best < 1, grouped by module, each row = module number, prompt
truncated to 90 chars, best %, and a "Practise" button that opens the module with that card
scrolled into view and briefly outlined. If nothing is below 1, show an empty state that
says so plainly. A "Start drill" button sequences up to 10 of those items one per screen
with its own progress line and a final summary.

Error log view: table of `log` entries newest first: time, module, item id, score, the answer
given (truncated to 120 chars), and the `why` for that item. Empty state when clean.

## Style

Dark technical, restrained, readable. One accent colour (warm orange `#e8743f` dark,
`#c2491b` light) used consistently for interactive emphasis only. Correct `#4fbf7f`,
wrong `#e0685f`, both desaturated enough to read on the panel. Neutrals are cool grey,
never pure black or pure white. Corner radii consistent: cards 12px, controls 8px, chips
pill. System font stack for text, `ui-monospace` for data, triples, ids and numbers.
No gradients on text, no glow, no emoji, no em dashes anywhere in visible copy (the data
file has none; do not introduce any). Respect `prefers-reduced-motion`.

## Acceptance (run these yourself, report real output)

1. `node --test test/` passes. The suite must include, at minimum:
   - `normalize` folding case, underscores, diacritics and a leading `the`.
   - mcq correct and wrong, asserting `lines` contains the option's `wrong` text.
   - multi partial credit, extra selection cancelling a hit.
   - triples: full match scores 1; a valid answer with a synonym predicate scores 1;
     a padded answer (correct lines plus 4 invented lines) scores less than 1; unparseable
     line reported.
   - categorize partial credit.
   - order correct and reversed.
   - cloze alias and 4-char substring.
   - numeric `0.64` and `64%` both correct.
   - one MUST-FAIL style case: a deliberately wrong answer must score 0, proving the grader
     can reject.
2. `node build.mjs` writes `dist/knowledge-graphs-course.html`; grep it: no `http://`,
   no `https://`, no `node_modules`, no `__DATA__` token left, size under 400 KB.
3. Every exercise in `src/data.json` grades without throwing: a test iterates all 28 items
   with a synthetic answer per type and asserts `0 <= score <= 1`.
4. The built file opens and renders: `node -e` sanity is not enough, so also assert the
   built HTML contains the string `Instructions` and that `dist` HTML has no `export ` or
   `import ` statements left (inlined scripts must be plain).

## Boundaries

- Do not edit `src/data.json` content: ids, prompts, options, answers, aliases, why text and
  instructions are authored and reviewed. Rendering only.
- No frameworks, no build tooling beyond the one `build.mjs`, no dependencies, no network.
- Do not add analytics, service workers, or external fonts.
- Commit only the files this spec creates.
