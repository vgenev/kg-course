'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { normalize, grade } = require('../src/grader.js');
const data = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../src/data.json'), 'utf8')
);

const m2e1 = data.modules
  .flatMap((m) => m.exercises)
  .find((e) => e.id === 'm2e1');

const GOLD_FIVE =
  'mira kolar | works at | vantor labs\n' +
  'mira kolar | role | head of hardware\n' +
  'vantor labs | located in | nis\n' +
  'vantor labs | supplies | zarya energy\n' +
  'mira kolar | worked at | kestrel robotics';

describe('normalize', () => {
  it('folds case, underscores, diacritics and leading the', () => {
    assert.equal(normalize('Niš'), 'nis');
    assert.equal(normalize('works_at'), 'works at');
    assert.equal(normalize('The Vantor'), 'vantor');
  });
});

describe('mcq', () => {
  const ex = data.modules[0].exercises[0];
  it('correct', () => {
    const r = grade(ex, ex.answer);
    assert.equal(r.score, 1);
    assert.equal(r.verdict, 'correct');
  });
  it('wrong includes wrong text in lines', () => {
    const r = grade(ex, 0);
    assert.equal(r.score, 0);
    assert.ok(r.lines.some((l) => l.includes('One edge, one city')));
  });
});

describe('multi', () => {
  const ex = data.modules[1].exercises.find((e) => e.id === 'm2e2');
  it('partial credit and extra cancels hit', () => {
    const r = grade(ex, [0, 1]);
    assert.equal(r.score, 0);
    assert.ok(r.lines.some((l) => l.startsWith('Wrongly included')));
  });
  it('full selection', () => {
    const r = grade(ex, ex.answers);
    assert.equal(r.score, 1);
  });
});

describe('triples', () => {
  it('full match scores 1', () => {
    const r = grade(m2e1, GOLD_FIVE);
    assert.equal(r.score, 1);
  });
  it('synonym predicate scores 1', () => {
    const syn = GOLD_FIVE.replace('works at', 'works for');
    const r = grade(m2e1, syn);
    assert.equal(r.score, 1);
  });
  it('padded answer scores below 1', () => {
    const padded =
      GOLD_FIVE +
      '\nfoo | bar | baz\na | b | c\nd | e | f\ng | h | i';
    const r = grade(m2e1, padded);
    assert.ok(r.score < 1);
    assert.ok(r.score > 0);
  });
  it('unparseable line reported', () => {
    const r = grade(m2e1, 'not a triple');
    assert.ok(r.lines.some((l) => l.includes('Line 1 is not subject')));
  });
});

describe('categorize', () => {
  const ex = data.modules[0].exercises.find((e) => e.id === 'm1e2');
  it('partial credit', () => {
    const r = grade(ex, { 0: 0, 1: 1 });
    assert.equal(r.score, 0.5);
    assert.ok(r.lines.length > 0);
  });
});

describe('order', () => {
  const ex = data.modules[0].exercises.find((e) => e.id === 'm1e4');
  it('correct', () => {
    const r = grade(ex, [0, 1, 2, 3, 4]);
    assert.equal(r.score, 1);
  });
  it('reversed wrong', () => {
    const r = grade(ex, [4, 3, 2, 1, 0]);
    assert.equal(r.score, 0);
    assert.ok(r.lines[0].startsWith('Correct order:'));
  });
});

describe('cloze', () => {
  const ex = data.modules.find((m) => m.id === 'm6').exercises.find(
    (e) => e.id === 'm6e3'
  );
  it('alias match', () => {
    const r = grade(ex, ['false negative']);
    assert.equal(r.score, 1);
  });
  it('4-char substring', () => {
    const r = grade(ex, ['merge']);
    assert.equal(r.score, 1);
  });
});

describe('numeric', () => {
  const ex = data.modules.find((m) => m.id === 'm9').exercises.find(
    (e) => e.id === 'm9e1'
  );
  it('accepts decimal', () => {
    assert.equal(grade(ex, '0.64').score, 1);
  });
  it('accepts percent', () => {
    assert.equal(grade(ex, '64%').score, 1);
  });
});

describe('must-fail rejection', () => {
  it('deliberately wrong mcq scores 0', () => {
    const ex = data.modules[0].exercises[0];
    const r = grade(ex, 999);
    assert.equal(r.score, 0);
    assert.equal(r.verdict, 'wrong');
  });
});

describe('all course exercises', () => {
  const all = data.modules.flatMap((m) => m.exercises);
  assert.equal(all.length, 28);

  function synthetic(ex) {
    switch (ex.type) {
      case 'mcq':
        return 0;
      case 'multi':
        return [];
      case 'triples':
        return '';
      case 'categorize':
        return {};
      case 'order':
        return ex.items.map((_, i) => (i + 1) % ex.items.length);
      case 'cloze':
        return ex.blanks.map(() => 'x');
      case 'numeric':
        return '0';
      default:
        return null;
    }
  }

  for (const ex of all) {
    it('grades ' + ex.id + ' without throwing', () => {
      const r = grade(ex, synthetic(ex));
      assert.ok(r.score >= 0 && r.score <= 1);
    });
  }
});
