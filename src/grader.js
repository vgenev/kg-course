(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KGGrader = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function normalize(str) {
    let s = String(str);
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    s = s.toLowerCase().replace(/[_-]+/g, ' ');
    s = s.replace(/[^a-z0-9 %]/g, '');
    s = s.replace(/\s+/g, ' ').trim();
    if (s.startsWith('the ')) s = s.slice(4);
    return s;
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function verdictFromScore(score) {
    if (score >= 1) return 'correct';
    if (score > 0) return 'partial';
    return 'wrong';
  }

  function gradeMcq(exercise, answer) {
    const idx = answer;
    const correct = idx === exercise.answer;
    const score = correct ? 1 : 0;
    const lines = [];
    if (!correct) {
      const w = exercise.wrong[idx];
      if (w) lines.push(w);
    }
    return {
      score,
      max: 1,
      verdict: verdictFromScore(score),
      why: exercise.why,
      lines,
      detail: { selected: idx, correct: exercise.answer },
    };
  }

  function gradeMulti(exercise, answer) {
    const selected = Array.isArray(answer) ? answer.map(Number) : [];
    const answers = exercise.answers.map(Number);
    const selSet = new Set(selected);
    const ansSet = new Set(answers);
    let hits = 0;
    for (const i of selSet) {
      if (ansSet.has(i)) hits++;
    }
    let extra = 0;
    for (const i of selSet) {
      if (!ansSet.has(i)) extra++;
    }
    const missed = answers.filter((i) => !selSet.has(i));
    const raw = Math.max(0, hits - extra) / answers.length;
    const score = round2(raw);
    const lines = [];
    for (const i of missed) {
      lines.push('Missed: ' + exercise.options[i]);
      if (exercise.notes[i]) lines.push(exercise.notes[i]);
    }
    for (const i of selected) {
      if (!ansSet.has(i)) {
        lines.push('Wrongly included: ' + exercise.options[i]);
        if (exercise.notes[i]) lines.push(exercise.notes[i]);
      }
    }
    return {
      score,
      max: 1,
      verdict: verdictFromScore(score),
      why: exercise.why,
      lines,
      detail: { hits, extra, missed, selected },
    };
  }

  function parseTripleLine(line) {
    let parts = line.split(/\s*\|\s*/);
    if (parts.length !== 3) {
      parts = line.split('\t');
    }
    parts = parts.map((p) => p.trim()).filter((p) => p.length > 0);
    if (parts.length !== 3) return null;
    return parts;
  }

  function aliasSet(aliases) {
    const set = new Set();
    for (const a of aliases) set.add(normalize(a));
    return set;
  }

  function tripleMatches(parsed, expected) {
    const sSet = aliasSet(expected.s);
    const pSet = aliasSet(expected.p);
    const oSet = aliasSet(expected.o);
    return (
      sSet.has(normalize(parsed[0])) &&
      pSet.has(normalize(parsed[1])) &&
      oSet.has(normalize(parsed[2]))
    );
  }

  function gradeTriples(exercise, answer) {
    const raw = String(answer || '');
    const rawLines = raw.split(/\r?\n/);
    const parsed = [];
    const parseErrors = [];
    const unmatchedRaw = [];

    for (let i = 0; i < rawLines.length; i++) {
      const trimmed = rawLines[i].trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const triple = parseTripleLine(trimmed);
      if (!triple) {
        parseErrors.push({ lineNum: i + 1, raw: trimmed });
      } else {
        parsed.push({ triple, raw: trimmed, used: false });
      }
    }

    const expected = exercise.expected;
    let matched = 0;
    const missing = [];

    for (const exp of expected) {
      let found = false;
      for (const row of parsed) {
        if (row.used) continue;
        if (tripleMatches(row.triple, exp)) {
          row.used = true;
          found = true;
          matched++;
          break;
        }
      }
      if (!found) {
        missing.push(exp);
      }
    }

    for (const row of parsed) {
      if (!row.used) unmatchedRaw.push(row.raw);
    }
    for (const err of parseErrors) {
      unmatchedRaw.push(err.raw);
    }

    const inputLines = parsed.length + parseErrors.length;
    const rawScore =
      (matched - 0.5 * (inputLines - matched)) / expected.length;
    const score = round2(Math.max(0, rawScore));

    const outLines = [];
    if (score < 1) {
      for (const err of parseErrors) {
        outLines.push(
          'Line ' + err.lineNum + ' is not subject | predicate | object'
        );
      }
      for (const exp of missing) {
        outLines.push(
          'Missing: ' + exp.s[0] + ' | ' + exp.p[0] + ' | ' + exp.o[0]
        );
      }
      for (const rawLine of unmatchedRaw) {
        if (parseErrors.some((e) => e.raw === rawLine)) continue;
        outLines.push('Not in the source: ' + rawLine);
      }
    }

    return {
      score,
      max: 1,
      verdict: verdictFromScore(score),
      why: exercise.why,
      lines: outLines,
      detail: {
        matched,
        expected: expected.length,
        parsed: parsed.map((r) => r.triple),
        missing,
        extra: unmatchedRaw,
        parseErrors,
      },
    };
  }

  function gradeCategorize(exercise, answer) {
    const map = answer && typeof answer === 'object' ? answer : {};
    const items = exercise.items;
    let correct = 0;
    const lines = [];
    for (let i = 0; i < items.length; i++) {
      const chosen = map[i] !== undefined ? Number(map[i]) : -1;
      const expected = items[i].bucket;
      if (chosen === expected) {
        correct++;
      } else {
        const chosenLabel =
          chosen >= 0 && chosen < exercise.buckets.length
            ? exercise.buckets[chosen]
            : '(none)';
        lines.push(
          items[i].text +
            ': you chose ' +
            chosenLabel +
            ', correct is ' +
            exercise.buckets[expected]
        );
        if (items[i].note) lines.push(items[i].note);
      }
    }
    const score = round2(correct / items.length);
    return {
      score,
      max: 1,
      verdict: verdictFromScore(score),
      why: exercise.why,
      lines,
      detail: { correct, total: items.length },
    };
  }

  function gradeOrder(exercise, answer) {
    const n = exercise.items.length;
    const expectedSeq = [];
    for (let i = 0; i < n; i++) expectedSeq.push(i);
    const user = Array.isArray(answer) ? answer.map(Number) : [];
    const ok =
      user.length === n &&
      user.every((v, i) => v === expectedSeq[i]);
    const score = ok ? 1 : 0;
    const lines = [];
    if (!ok) {
      const parts = exercise.items.map(
        (t, i) => (i + 1) + ') ' + t
      );
      lines.push('Correct order: ' + parts.join(' '));
    }
    return {
      score,
      max: 1,
      verdict: verdictFromScore(score),
      why: exercise.why,
      lines,
      detail: { user, expected: expectedSeq },
    };
  }

  function blankCorrect(blank, value) {
    const nv = normalize(value);
    if (!nv) return false;
    for (const a of blank.accept) {
      const na = normalize(a);
      if (nv === na) return true;
      if (nv.length >= 4 && na.includes(nv)) return true;
    }
    return false;
  }

  function gradeCloze(exercise, answer) {
    const vals = Array.isArray(answer) ? answer : [];
    const blanks = exercise.blanks;
    let correct = 0;
    const lines = [];
    for (let i = 0; i < blanks.length; i++) {
      const v = vals[i] != null ? String(vals[i]) : '';
      if (blankCorrect(blanks[i], v)) {
        correct++;
      } else {
        const first = blanks[i].accept[0];
        const note = blanks[i].note ? ' ' + blanks[i].note : '';
        lines.push(
          "Blank " +
            (i + 1) +
            ": you wrote '" +
            v +
            "'. Accepted: " +
            first +
            '.' +
            note
        );
      }
    }
    const score = round2(correct / blanks.length);
    return {
      score,
      max: 1,
      verdict: verdictFromScore(score),
      why: exercise.why,
      lines,
      detail: { correct, total: blanks.length },
    };
  }

  function gradeNumeric(exercise, answer) {
    const cleaned = String(answer || '')
      .replace(/%/g, '')
      .replace(/,/g, '')
      .replace(/\s/g, '');
    let v = parseFloat(cleaned);
    if (Number.isNaN(v)) {
      return {
        score: 0,
        max: 1,
        verdict: 'wrong',
        why: exercise.why,
        lines: [],
        detail: { parsed: NaN },
      };
    }
    if (v > 1) v = v / 100;
    const ok = Math.abs(v - exercise.answer) <= exercise.tolerance;
    const score = ok ? 1 : 0;
    return {
      score,
      max: 1,
      verdict: verdictFromScore(score),
      why: exercise.why,
      lines: [],
      detail: { parsed: v, expected: exercise.answer },
    };
  }

  function grade(exercise, answer) {
    const type = exercise.type;
    switch (type) {
      case 'mcq':
        return gradeMcq(exercise, answer);
      case 'multi':
        return gradeMulti(exercise, answer);
      case 'triples':
        return gradeTriples(exercise, answer);
      case 'categorize':
        return gradeCategorize(exercise, answer);
      case 'order':
        return gradeOrder(exercise, answer);
      case 'cloze':
        return gradeCloze(exercise, answer);
      case 'numeric':
        return gradeNumeric(exercise, answer);
      default:
        throw new Error('unknown exercise type: ' + type);
    }
  }

  return {
    normalize,
    grade,
  };
});
