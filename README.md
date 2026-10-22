# Knowledge Graphs course

An offline, single-file course app. Content follows the daVault curriculum
(`02-Resources/tech/kg-agentic-graph-design-course-checklist.md`): 4 phases, 13 parts,
44 graded items covering manual extraction, Extract → Resolve → Assemble → Query, and
agentic graph design.

## Open it

`dist/knowledge-graphs-course.html` opens by double-click. No network, no install.
Progress is stored in the browser's localStorage for that file; use Export to move it.

## How it grades

| Type | What it checks | Scoring |
|---|---|---|
| mcq | one click, locks | all or nothing |
| multi | select several | right minus wrong over expected, floor 0 |
| triples | free text, `s \| p \| o` per line | per expected triple, minus half per unmatched extra line |
| categorize | bucket per card | fraction correct |
| order | click into sequence | exact sequence |
| cloze | inline input | per blank, aliases + 4-char substring |
| numeric | decimal or percent | within tolerance |

Matching ignores case, underscores, hyphens, hashes, accents and a leading "the", so
`Niš`, `nis` and `NIS` are one value. Predicates match a synonym list per item.

Every wrong answer returns: what the right shape is, why, and the specific correction for
what you chose or wrote. Best score per item is kept; every miss is kept in the error log.

## Editing content

Content is data, not markup: `src/data.json`. Shapes are documented in
`docs/BUILD-SPEC.md` under "Content contract". After editing:

```bash
node build.mjs        # rewrites dist/knowledge-graphs-course.html
npm test              # grader + data integrity tests
```

## Layout

```
src/data.json            course content (13 modules, 44 items)
src/grader.js            pure grading engine, no DOM (UMD: browser global + Node require)
src/app.js               views, state, persistence
src/styles.css           all styling, dark and light via CSS variables
src/index.template.html  shell with the injection tokens
build.mjs                inlines everything into dist/
test/grader.test.cjs     61 assertions, including a must-fail case
docs/BUILD-SPEC.md       the work order the app was built against
```

## Verified

- `npm test`: 61 pass, 0 fail.
- Driven in a real browser: all 13 parts render, the Instructions panel sits before the
  first item in every part, wrong answers show the correction, retry works, the padded
  triple answer scores 50% instead of 100%, progress survives a reload, review queue and
  drill run, error log records every miss, no console errors.

## Live

https://vgenev.github.io/kg-course/

Built and deployed by GitHub Actions (`.github/workflows/pages.yml`) on every push to
`main`: the workflow runs `npm test`, builds the single file from `src/`, checks the output
for external URLs and unreplaced build tokens, then deploys it to Pages. Nothing generated
is committed, so the site cannot drift from the sources.

Local build is the same two commands:

```bash
npm test && node build.mjs     # writes dist/knowledge-graphs-course.html
```
