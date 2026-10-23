(function () {
  const grader = window.KGGrader;
  const STORAGE_KEY = 'kg-course-v1';

  let persistOk = true;
  let state = defaultState();
  const cardState = {};
  let view = { kind: 'overview' };
  let drill = null;
  let focusExerciseId = null;
  let scratchUnmount = null;

  function scratchPadKey() {
    if (view.kind === 'module') return view.id;
    return 'overview';
  }

  function scratchVisibleForView() {
    return (
      state.scratchOpen &&
      (view.kind === 'overview' || view.kind === 'module')
    );
  }

  function buildScratchBlock(container) {
    const block = el('div', { className: 'scratch-block' });
    block.appendChild(el('h2', { className: 'scratch-heading', text: 'Scratchpad' }));
    const mountPt = el('div', { className: 'scratch-mount' });
    block.appendChild(mountPt);
    container.appendChild(block);
    return mountPt;
  }

  function buildScratchColumn(shell) {
    const aside = el('aside', {
      className: 'scratch-column',
      'aria-label': 'Scratchpad',
    });
    const inner = el('div', { className: 'scratch-column-inner' });
    inner.appendChild(el('h2', { className: 'scratch-heading', text: 'Scratchpad' }));
    const mountPt = el('div', { className: 'scratch-mount' });
    inner.appendChild(mountPt);
    aside.appendChild(inner);
    shell.appendChild(aside);
    return mountPt;
  }

  function attachScratchMount(mountPt, padKey) {
    if (scratchUnmount) scratchUnmount();
    scratchUnmount = window.KGScratchpad.mount(mountPt, padKey);
  }

  function defaultState() {
    return { v: 1, rec: {}, log: [], scratchOpen: false };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.v === 1) {
          state = {
            v: 1,
            rec: parsed.rec || {},
            log: Array.isArray(parsed.log) ? parsed.log : [],
            scratchOpen: !!parsed.scratchOpen,
          };
        }
      }
    } catch (_) {
      persistOk = false;
    }
  }

  function saveState() {
    if (!persistOk) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      persistOk = false;
      render();
    }
  }

  function allExercises() {
    return COURSE.modules.flatMap((m) =>
      m.exercises.map((e) => ({ module: m, exercise: e }))
    );
  }

  function modulesInPhase(phaseId) {
    return COURSE.modules.filter((m) => m.phase === phaseId);
  }

  function phaseForModule(mod) {
    return COURSE.phases.find((p) => p.id === mod.phase);
  }

  function findExercise(id) {
    for (const m of COURSE.modules) {
      const ex = m.exercises.find((e) => e.id === id);
      if (ex) return { module: m, exercise: ex };
    }
    return null;
  }

  function recFor(id) {
    return state.rec[id] || { best: 0, attempts: 0, last: 0 };
  }

  function moduleMastery(mod) {
    const scores = mod.exercises.map((e) => recFor(e.id).best);
    if (!scores.length) return 0;
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    return mean;
  }

  function overallMastery() {
    const all = allExercises();
    if (!all.length) return 0;
    const sum = all.reduce((s, { exercise }) => s + recFor(exercise.id).best, 0);
    return sum / all.length;
  }

  function stats() {
    const all = allExercises();
    const total = all.length;
    let solved = 0;
    let attempted = 0;
    let weakest = null;
    let weakestVal = 2;
    for (const m of COURSE.modules) {
      const mm = moduleMastery(m);
      if (mm < weakestVal) {
        weakestVal = mm;
        weakest = m;
      }
      for (const e of m.exercises) {
        const r = recFor(e.id);
        if (r.best >= 1) solved++;
        if (r.attempts > 0) attempted++;
      }
    }
    return {
      total,
      solved,
      attempted,
      meanPct: Math.round(overallMastery() * 100),
      weakest,
    };
  }

  function reviewList() {
    return allExercises().filter(({ exercise }) => recFor(exercise.id).best < 1);
  }

  function defaultDraft(ex) {
    switch (ex.type) {
      case 'mcq':
        return null;
      case 'multi':
        return [];
      case 'triples':
        return '';
      case 'categorize':
        return {};
      case 'order':
        return [];
      case 'cloze':
        return ex.blanks.map(() => '');
      case 'numeric':
        return '';
      default:
        return null;
    }
  }

  function getCard(id, ex) {
    if (!cardState[id]) {
      cardState[id] = {
        draft: defaultDraft(ex),
        result: null,
        locked: false,
        showAnswer: false,
      };
    }
    return cardState[id];
  }

  function recordGrade(exercise, answer, result) {
    const id = exercise.id;
    const prev = recFor(id);
    const best = Math.max(prev.best, result.score);
    state.rec[id] = {
      best,
      attempts: prev.attempts + 1,
      last: Date.now(),
    };
    if (result.score < 1) {
      state.log.push({
        id,
        score: result.score,
        given: answer,
        at: Date.now(),
      });
      if (state.log.length > 200) {
        state.log = state.log.slice(-200);
      }
    }
    saveState();
  }

  function verdictLabel(v) {
    if (v === 'correct') return 'Correct';
    if (v === 'partial') return 'Partly right';
    return 'Not right yet';
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'className') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v != null) node.setAttribute(k, v);
      }
    }
    if (children != null) {
      const list = Array.isArray(children) ? children : [children];
      for (const c of list) {
        if (c == null) continue;
        if (typeof c === 'string') node.appendChild(document.createTextNode(c));
        else node.appendChild(c);
      }
    }
    return node;
  }

  function renderFeedback(container, result, exercise, card) {
    const panel = el('div', { className: 'feedback', role: 'status' });
    const bar = el('div', {
      className: 'verdict-bar ' + result.verdict,
      text:
        verdictLabel(result.verdict) +
        ' (' +
        Math.round(result.score * 100) +
        '%)',
    });
    panel.appendChild(bar);
    panel.appendChild(el('p', { text: result.why }));
    for (const line of result.lines) {
      panel.appendChild(el('p', { className: 'feedback-line', text: line }));
    }
    if (result.score < 1) {
      const tryBtn = el('button', {
        type: 'button',
        className: 'btn-secondary',
        text: 'Try again',
      });
      tryBtn.addEventListener('click', () => {
        card.result = null;
        card.locked = false;
        card.showAnswer = false;
        if (exercise.type !== 'mcq') card.draft = defaultDraft(exercise);
        render();
      });
      panel.appendChild(tryBtn);
    }
    if (
      (exercise.type === 'triples' || exercise.type === 'cloze') &&
      !card.showAnswer
    ) {
      const showBtn = el('button', {
        type: 'button',
        className: 'btn-secondary',
        text: 'Show answer',
      });
      showBtn.addEventListener('click', () => {
        card.showAnswer = true;
        render();
      });
      panel.appendChild(showBtn);
    }
    if (card.showAnswer) {
      const ans = el('div', { className: 'hint-line' });
      if (exercise.type === 'triples') {
        const lines = exercise.expected.map(
          (t) => t.s[0] + ' | ' + t.p[0] + ' | ' + t.o[0]
        );
        ans.textContent = lines.join('\n');
      } else if (exercise.type === 'cloze') {
        ans.textContent = exercise.blanks
          .map((b) => b.accept[0])
          .join(', ');
      }
      panel.appendChild(ans);
    }
    container.appendChild(panel);
  }

  function gradeCard(exercise, card) {
    const result = grader.grade(exercise, card.draft);
    card.result = result;
    recordGrade(exercise, card.draft, result);
    render();
  }

  function renderExerciseControls(exercise, card, wrap) {
    const t = exercise.type;
    if (t === 'mcq') {
      exercise.options.forEach((opt, i) => {
        const btn = el('button', {
          type: 'button',
          className:
            'option-row' +
            (card.draft === i ? ' selected' : ''),
          disabled: card.locked ? 'true' : null,
        });
        btn.textContent = opt;
        btn.addEventListener('click', () => {
          if (card.locked) return;
          card.draft = i;
          card.locked = true;
          gradeCard(exercise, card);
        });
        wrap.appendChild(btn);
      });
    } else if (t === 'multi') {
      exercise.options.forEach((opt, i) => {
        const row = el('label', { className: 'check-row' });
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = card.draft.includes(i);
        cb.addEventListener('change', () => {
          if (cb.checked) {
            if (!card.draft.includes(i)) card.draft.push(i);
          } else {
            card.draft = card.draft.filter((x) => x !== i);
          }
        });
        row.appendChild(cb);
        row.appendChild(document.createTextNode(opt));
        wrap.appendChild(row);
      });
      const chk = el('button', {
        type: 'button',
        className: 'btn-check',
        text: 'Check',
      });
      chk.addEventListener('click', () => gradeCard(exercise, card));
      wrap.appendChild(chk);
    } else if (t === 'triples') {
      const ta = el('textarea', {
        className: 'triples-area',
        rows: '6',
        placeholder: exercise.format,
      });
      ta.value = card.draft;
      ta.addEventListener('input', () => {
        card.draft = ta.value;
      });
      wrap.appendChild(ta);
      wrap.appendChild(
        el('div', {
          className: 'hint-line',
          text: 'Example: ' + exercise.example,
        })
      );
      if (exercise.hint) {
        wrap.appendChild(el('div', { className: 'hint-line', text: exercise.hint }));
      }
      wrap.appendChild(
        el('button', {
          type: 'button',
          className: 'btn-check',
          text: 'Check',
          onClick: () => gradeCard(exercise, card),
        })
      );
    } else if (t === 'categorize') {
      exercise.items.forEach((item, i) => {
        const row = el('div', { className: 'categorize-item' });
        row.appendChild(el('span', { text: item.text }));
        exercise.buckets.forEach((b, bi) => {
          const bb = el('button', {
            type: 'button',
            className:
              'bucket-btn' + (card.draft[i] === bi ? ' active' : ''),
            text: b,
          });
          bb.addEventListener('click', () => {
            card.draft[i] = bi;
            render();
          });
          row.appendChild(bb);
        });
        wrap.appendChild(row);
      });
      wrap.appendChild(
        el('button', {
          type: 'button',
          className: 'btn-check',
          text: 'Check',
          onClick: () => gradeCard(exercise, card),
        })
      );
    } else if (t === 'order') {
      const ow = el('div', { className: 'order-wrap' });
      const pool = el('div', { className: 'order-pool' });
      const seq = el('div', { className: 'order-seq' });
      const inSeq = new Set(card.draft);
      exercise.items.forEach((text, i) => {
        if (!inSeq.has(i)) {
          const b = el('button', {
            type: 'button',
            className: 'order-step',
            text: text,
          });
          b.addEventListener('click', () => {
            card.draft.push(i);
            render();
          });
          pool.appendChild(b);
        }
      });
      card.draft.forEach((idx, pos) => {
        const b = el('button', {
          type: 'button',
          className: 'order-step',
          'data-pos': String(pos + 1),
          text: exercise.items[idx],
        });
        b.addEventListener('click', () => {
          card.draft = card.draft.filter((x) => x !== idx);
          render();
        });
        seq.appendChild(b);
      });
      ow.appendChild(el('div', { text: 'Available steps' }));
      ow.appendChild(pool);
      ow.appendChild(el('div', { text: 'Your sequence' }));
      ow.appendChild(seq);
      wrap.appendChild(ow);
      wrap.appendChild(
        el('button', {
          type: 'button',
          className: 'btn-check',
          text: 'Check',
          onClick: () => gradeCard(exercise, card),
        })
      );
    } else if (t === 'cloze') {
      const parts = exercise.sentence.split('______');
      const line = el('p', { className: 'cloze-sentence' });
      line.appendChild(document.createTextNode(parts[0] || ''));
      const inp = el('input', {
        className: 'cloze-input',
        type: 'text',
        value: card.draft[0] || '',
      });
      inp.addEventListener('input', () => {
        card.draft[0] = inp.value;
      });
      line.appendChild(inp);
      line.appendChild(document.createTextNode(parts[1] || ''));
      wrap.appendChild(line);
      wrap.appendChild(
        el('button', {
          type: 'button',
          className: 'btn-check',
          text: 'Check',
          onClick: () => gradeCard(exercise, card),
        })
      );
    } else if (t === 'numeric') {
      const inp = el('input', {
        className: 'num-input',
        type: 'text',
        inputmode: 'decimal',
        value: card.draft,
      });
      inp.addEventListener('input', () => {
        card.draft = inp.value;
      });
      wrap.appendChild(inp);
      if (exercise.hint) {
        wrap.appendChild(el('div', { className: 'hint-line', text: exercise.hint }));
      }
      wrap.appendChild(
        el('button', {
          type: 'button',
          className: 'btn-check',
          text: 'Check',
          onClick: () => gradeCard(exercise, card),
        })
      );
    }
    if (card.result) renderFeedback(wrap, card.result, exercise, card);
  }

  function renderLesson(lesson, container) {
    const box = el('div', { className: 'lesson' });
    for (const block of lesson) {
      if (block.t === 'p') {
        box.appendChild(el('p', { text: block.x }));
      } else if (block.t === 'h') {
        box.appendChild(el('h2', { text: block.x }));
      } else if (block.t === 'ul') {
        const ul = el('ul');
        for (const li of block.x) ul.appendChild(el('li', { text: li }));
        box.appendChild(ul);
      } else if (block.t === 'code') {
        const wrap = el('div', { className: 'code-block-wrap' });
        const pre = el('pre', { text: block.x });
        const copy = el('button', {
          type: 'button',
          className: 'btn-copy',
          text: 'Copy',
        });
        copy.addEventListener('click', () => {
          navigator.clipboard.writeText(block.x).catch(() => {});
        });
        wrap.appendChild(pre);
        wrap.appendChild(copy);
        box.appendChild(wrap);
      } else if (block.t === 'note') {
        box.appendChild(el('div', { className: 'note-callout', text: block.x }));
      }
    }
    container.appendChild(box);
  }

  function renderInstructions(instructions, container) {
    const panel = el('div', { className: 'instructions-panel' });
    panel.appendChild(el('h2', { text: 'Instructions' }));
    const ol = el('ol');
    for (const line of instructions) {
      ol.appendChild(el('li', { text: line }));
    }
    panel.appendChild(ol);
    container.appendChild(panel);
  }

  function renderModule(mod, container) {
    container.appendChild(el('p', { className: 'kicker', text: mod.kicker }));
    container.appendChild(el('h1', { text: mod.title }));
    container.appendChild(el('p', { className: 'goal', text: mod.goal }));
    const ph = phaseForModule(mod);
    if (ph) {
      container.appendChild(
        el('p', {
          className: 'module-meta',
          text: ph.label + ' · ' + mod.weeks,
        })
      );
    }
    renderLesson(mod.lesson, container);
    if (mod.text) {
      const st = el('div', { className: 'sample-text' });
      st.appendChild(el('h3', { text: 'Sample text' }));
      st.appendChild(el('pre', { text: mod.text.body }));
      container.appendChild(st);
    }
    if (mod.instructions && mod.instructions.length) {
      renderInstructions(mod.instructions, container);
    }
    const n = mod.exercises.length;
    mod.exercises.forEach((exercise, idx) => {
      const card = getCard(exercise.id, exercise);
      const cardEl = el('article', {
        className:
          'exercise-card' +
          (focusExerciseId === exercise.id ? ' flash-outline' : ''),
        id: 'ex-' + exercise.id,
      });
      cardEl.appendChild(
        el('div', {
          className: 'exercise-meta',
          text: 'Item ' + (idx + 1) + ' of ' + n,
        })
      );
      if (exercise.type !== 'cloze') {
        cardEl.appendChild(
          el('div', { className: 'exercise-prompt', text: exercise.prompt })
        );
      }
      const controls = el('div', { className: 'exercise-controls' });
      renderExerciseControls(exercise, card, controls);
      cardEl.appendChild(controls);
      container.appendChild(cardEl);
    });
    const mm = Math.round(moduleMastery(mod) * 100);
    const strip = el('div', { className: 'completion-strip' });
    strip.appendChild(
      el('span', { text: 'Part mastery: ' + mm + '%' })
    );
    const next = COURSE.modules.find((m) => m.num === mod.num + 1);
    if (next) {
      strip.appendChild(
        el('button', {
          type: 'button',
          className: 'btn-check',
          text: 'Next part',
          onClick: () => {
            view = { kind: 'module', id: next.id };
            render();
          },
        })
      );
    }
    container.appendChild(strip);
  }

  function renderOverview(container) {
    container.appendChild(el('h1', { text: COURSE.course.title }));
    container.appendChild(
      el('p', { className: 'goal', text: COURSE.course.subtitle })
    );
    container.appendChild(el('h2', { text: 'How this works' }));
    const ul = el('ul');
    for (const h of COURSE.course.howto) {
      ul.appendChild(el('li', { text: h }));
    }
    container.appendChild(ul);
    const st = stats();
    const row = el('div', { className: 'stats-row' });
    const mkStat = (label, value) => {
      const s = el('span');
      s.appendChild(document.createTextNode(label + ' '));
      const strong = el('strong', { text: value });
      s.appendChild(strong);
      return s;
    };
    row.appendChild(
      mkStat('Items solved:', st.solved + '/' + st.total)
    );
    row.appendChild(mkStat('Mean mastery:', st.meanPct + '%'));
    row.appendChild(mkStat('Items attempted:', String(st.attempted)));
    if (st.weakest) {
      row.appendChild(mkStat('Weakest part:', 'Part ' + st.weakest.num));
    }
    container.appendChild(row);
    if (COURSE.course.source) {
      container.appendChild(
        el('p', {
          className: 'course-source',
          text: 'Source: ' + COURSE.course.source,
        })
      );
    }
    for (const phase of COURSE.phases) {
      const mods = modulesInPhase(phase.id);
      if (!mods.length) continue;
      const heading = el('div', { className: 'phase-heading' });
      heading.appendChild(el('h2', { text: phase.label }));
      if (phase.note) {
        heading.appendChild(el('p', { text: phase.note }));
      }
      container.appendChild(heading);
      const grid = el('div', { className: 'module-grid' });
      for (const m of mods) {
        const mm = Math.round(moduleMastery(m) * 100);
        const anyAttempt = m.exercises.some((e) => recFor(e.id).attempts > 0);
        const openModule = () => {
          view = { kind: 'module', id: m.id };
          render();
        };
        const card = el('div', { className: 'module-card' });
        // The whole card is the target, not just its Open button.
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute(
          'aria-label',
          'Open module ' + m.num + ': ' + m.title
        );
        card.addEventListener('click', (ev) => {
          if (ev.target && ev.target.closest && ev.target.closest('button')) return;
          openModule();
        });
        card.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            openModule();
          }
        });
        card.appendChild(
          el('div', {
            className: 'rail-num',
            text: String(m.num).padStart(2, '0'),
          })
        );
        card.appendChild(el('strong', { text: m.title }));
        card.appendChild(el('span', { text: m.kicker }));
        card.appendChild(el('p', { text: m.goal }));
        card.appendChild(
          el('span', {
            text: anyAttempt ? 'Mastery ' + mm + '%' : 'Not started',
          })
        );
        card.appendChild(
          el('button', {
            type: 'button',
            className: 'btn-check btn-open',
            text: 'Open',
            onClick: openModule,
          })
        );
        grid.appendChild(card);
      }
      container.appendChild(grid);
    }
  }

  function renderReview(container) {
    const weak = reviewList();
    if (!weak.length) {
      container.appendChild(
        el('div', {
          className: 'empty-state',
          text: 'Nothing below a perfect score. Your review list is empty.',
        })
      );
      return;
    }
    container.appendChild(el('h1', { text: 'Review' }));
    container.appendChild(
      el('button', {
        type: 'button',
        className: 'btn-check',
        text: 'Start drill',
        onClick: () => {
          const items = weak.slice(0, 10).map((w) => w.exercise.id);
          drill = { ids: items, index: 0, done: false };
          view = { kind: 'drill' };
          render();
        },
      })
    );
    const byMod = {};
    for (const { module, exercise } of weak) {
      if (!byMod[module.id]) byMod[module.id] = { module, items: [] };
      byMod[module.id].items.push(exercise);
    }
    for (const m of COURSE.modules) {
      const g = byMod[m.id];
      if (!g) continue;
      const grp = el('div', { className: 'review-group' });
      grp.appendChild(
        el('h3', {
          text: 'Part ' + String(m.num).padStart(2, '0') + ': ' + m.title,
        })
      );
      for (const exercise of g.items) {
        const row = el('div', { className: 'review-row' });
        const prompt =
          exercise.prompt.length > 90
            ? exercise.prompt.slice(0, 87) + '...'
            : exercise.prompt;
        row.appendChild(el('span', { text: prompt }));
        row.appendChild(
          el('span', {
            text: Math.round(recFor(exercise.id).best * 100) + '%',
          })
        );
        row.appendChild(
          el('button', {
            type: 'button',
            className: 'btn-secondary',
            text: 'Practise',
            onClick: () => {
              view = { kind: 'module', id: m.id };
              focusExerciseId = exercise.id;
              render();
              requestAnimationFrame(() => {
                const elx = document.getElementById('ex-' + exercise.id);
                if (elx) elx.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => {
                  focusExerciseId = null;
                }, 1500);
              });
            },
          })
        );
        grp.appendChild(row);
      }
      container.appendChild(grp);
    }
  }

  function advanceDrill(result) {
    if (!drill) return;
    if (!drill.summary) drill.summary = [];
    drill.summary.push(result.score);
    if (drill.index + 1 >= drill.ids.length) drill.done = true;
    else drill.index++;
    render();
  }

  function renderDrill(container) {
    if (!drill || drill.done) {
      container.appendChild(el('h1', { text: 'Drill complete' }));
      const scores = (drill && drill.summary) || [];
      const avg =
        scores.length
          ? Math.round(
              (scores.reduce((a, b) => a + b, 0) / scores.length) * 100
            )
          : 0;
      container.appendChild(
        el('p', { text: 'Average score this drill: ' + avg + '%' })
      );
      container.appendChild(
        el('button', {
          type: 'button',
          className: 'btn-check',
          text: 'Back to review',
          onClick: () => {
            drill = null;
            view = { kind: 'review' };
            render();
          },
        })
      );
      return;
    }
    const id = drill.ids[drill.index];
    const found = findExercise(id);
    if (!found) {
      drill.done = true;
      render();
      return;
    }
    container.appendChild(
      el('div', {
        className: 'drill-progress',
        text:
          'Drill ' +
          (drill.index + 1) +
          ' of ' +
          drill.ids.length,
      })
    );
    const card = getCard(found.exercise.id, found.exercise);
    card.result = null;
    card.locked = false;
    const wrap = el('article', { className: 'exercise-card' });
    wrap.appendChild(
      el('div', { className: 'exercise-prompt', text: found.exercise.prompt })
    );
    const controls = el('div');
    const ex = found.exercise;
    const t = ex.type;
    if (t === 'mcq') {
      ex.options.forEach((opt, i) => {
        const btn = el('button', { type: 'button', className: 'option-row' });
        btn.textContent = opt;
        btn.addEventListener('click', () => {
          const result = grader.grade(ex, i);
          recordGrade(ex, i, result);
          advanceDrill(result);
        });
        controls.appendChild(btn);
      });
    } else {
      renderExerciseControls(ex, card, controls);
      const chk = controls.querySelector('.btn-check');
      if (chk) {
        chk.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const result = grader.grade(ex, card.draft);
          recordGrade(ex, card.draft, result);
          advanceDrill(result);
        });
      }
    }
    wrap.appendChild(controls);
    container.appendChild(wrap);
  }

  function renderErrorLog(container) {
    container.appendChild(el('h1', { text: 'Error log' }));
    if (!state.log.length) {
      container.appendChild(
        el('div', {
          className: 'empty-state',
          text: 'No misses logged yet.',
        })
      );
      return;
    }
    const table = el('table', { className: 'log-table' });
    const head = el('tr');
    for (const h of ['Time', 'Part', 'Item', 'Score', 'Given', 'Why']) {
      head.appendChild(el('th', { text: h }));
    }
    table.appendChild(el('thead', null, head));
    const tbody = el('tbody');
    const logs = state.log.slice().reverse();
    for (const entry of logs) {
      const found = findExercise(entry.id);
      const modNum = found ? found.module.num : '?';
      let givenStr = '';
      try {
        givenStr = JSON.stringify(entry.given);
      } catch (_) {
        givenStr = String(entry.given);
      }
      if (givenStr.length > 120) givenStr = givenStr.slice(0, 117) + '...';
      const why = found ? found.exercise.why : '';
      const tr = el('tr');
      tr.appendChild(
        el('td', {
          text: new Date(entry.at).toLocaleString(),
        })
      );
      tr.appendChild(el('td', { text: String(modNum) }));
      tr.appendChild(el('td', { text: entry.id }));
      tr.appendChild(
        el('td', { text: Math.round(entry.score * 100) + '%' })
      );
      tr.appendChild(el('td', { text: givenStr }));
      tr.appendChild(el('td', { text: why }));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);
  }

  function railMeter(mean) {
    const pct = Math.round(Math.max(0, Math.min(1, mean)) * 100);
    const meter = el('div', {
      className: 'meter' + (pct > 0 ? ' has-fill' : ''),
      role: 'img',
      'aria-label': 'Mastery ' + pct + '%',
    });
    const fill = el('div', { className: 'meter-fill' });
    fill.style.width = pct + '%';
    meter.appendChild(fill);
    return meter;
  }

  function renderRail(root) {
    const rail = el('aside', { className: 'rail' });
    const nav = el('nav', { className: 'rail-nav', 'aria-label': 'Course' });

    const ov = el('button', {
      type: 'button',
      className: 'rail-item',
      'aria-current': view.kind === 'overview' ? 'page' : null,
    });
    ov.appendChild(el('span', { className: 'rail-item-label', text: 'Overview' }));
    ov.addEventListener('click', () => {
      view = { kind: 'overview' };
      drill = null;
      render();
    });
    nav.appendChild(ov);

    for (const phase of COURSE.phases) {
      const mods = modulesInPhase(phase.id);
      if (!mods.length) continue;
      const header = el('div', { className: 'rail-phase-header' });
      header.appendChild(el('span', { className: 'rail-phase-label', text: phase.label }));
      if (phase.note) {
        header.appendChild(el('span', { className: 'rail-phase-note', text: phase.note }));
      }
      nav.appendChild(header);
      for (const m of mods) {
        const mm = moduleMastery(m);
        const btn = el('button', {
          type: 'button',
          className: 'rail-item',
          'aria-current':
            view.kind === 'module' && view.id === m.id ? 'page' : null,
        });
        const label = el('span', { className: 'rail-item-label' });
        label.appendChild(
          el('span', {
            className: 'rail-num',
            text: String(m.num).padStart(2, '0'),
          })
        );
        label.appendChild(document.createTextNode(m.title));
        btn.appendChild(label);
        btn.appendChild(railMeter(mm));
        btn.addEventListener('click', () => {
          view = { kind: 'module', id: m.id };
          drill = null;
          render();
        });
        nav.appendChild(btn);
      }
    }

    const weakN = reviewList().length;
    const rev = el('button', {
      type: 'button',
      className: 'rail-item',
      'aria-current': view.kind === 'review' || view.kind === 'drill' ? 'page' : null,
    });
    rev.appendChild(
      el('span', {
        className: 'rail-item-label',
        text: 'Review (' + weakN + ')',
      })
    );
    rev.addEventListener('click', () => {
      view = { kind: 'review' };
      drill = null;
      render();
    });
    nav.appendChild(rev);

    const logN = state.log.length;
    const logBtn = el('button', {
      type: 'button',
      className: 'rail-item',
      'aria-current': view.kind === 'log' ? 'page' : null,
    });
    logBtn.appendChild(
      el('span', {
        className: 'rail-item-label',
        text: 'Error log (' + logN + ')',
      })
    );
    logBtn.addEventListener('click', () => {
      view = { kind: 'log' };
      drill = null;
      render();
    });
    nav.appendChild(logBtn);

    rail.appendChild(nav);

    const foot = el('div', { className: 'rail-footer' });
    foot.appendChild(
      el('button', {
        type: 'button',
        text: 'Export',
        onClick: () => {
          const blob = new Blob([JSON.stringify(state, null, 2)], {
            type: 'application/json',
          });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'kg-course-progress.json';
          a.click();
          URL.revokeObjectURL(a.href);
        },
      })
    );
    const importLabel = el('label', { text: 'Import' });
    const importInput = el('input', {
      type: 'file',
      accept: 'application/json,.json',
      className: 'hidden-input',
    });
    importInput.addEventListener('change', () => {
      const file = importInput.files && importInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (!confirm('Replace all progress with the imported file?')) return;
          state = {
            v: 1,
            rec: parsed.rec || {},
            log: parsed.log || [],
            scratchOpen: !!parsed.scratchOpen,
          };
                saveState();
          render();
        } catch (_) {
          alert('Could not read that file.');
        }
      };
      reader.readAsText(file);
    });
    importLabel.appendChild(importInput);
    foot.appendChild(importLabel);
    foot.appendChild(
      el('button', {
        type: 'button',
        text: 'Reset',
        onClick: () => {
          if (!confirm('Clear all progress on this machine?')) return;
          state = defaultState();
                saveState();
          render();
        },
      })
    );
    rail.appendChild(foot);

    if (!persistOk) {
      rail.appendChild(
        el('p', {
          className: 'rail-persist-note',
          text: 'Progress will not persist here',
        })
      );
    }

    root.appendChild(rail);
  }

  let headerRO = null;
  function syncHeaderHeight(header) {
    const apply = () =>
      document.documentElement.style.setProperty(
        '--header-h',
        header.offsetHeight + 'px'
      );
    apply();
    if (headerRO) headerRO.disconnect();
    headerRO = new ResizeObserver(apply);
    headerRO.observe(header);
  }

  function render() {
    if (scratchUnmount) {
      scratchUnmount();
      scratchUnmount = null;
    }

    const root = document.getElementById('app');
    root.innerHTML = '';
    const wideScratch =
      window.matchMedia('(min-width: 1200px)').matches;
    const showScratch = scratchVisibleForView();
    const padKey = scratchPadKey();
    root.className = 'app-root';
    if (showScratch && wideScratch) {
      root.classList.add('scratch-wide');
    }

    const header = el('header', { className: 'app-header' });
    header.appendChild(el('span', { className: 'brand', text: 'KG Course' }));
    header.appendChild(
      el('span', {
        className: 'header-title',
        text: COURSE.course.title,
      })
    );
    const om = Math.round(overallMastery() * 100);
    header.appendChild(
      el('span', {
        className: 'header-mastery',
        text: 'Mastery ' + om + '%',
      })
    );
    const scratchBtn = el('button', {
      type: 'button',
      className: 'btn-pad btn-scratch',
      text: 'Scratchpad',
      'aria-pressed': state.scratchOpen ? 'true' : 'false',
    });
    scratchBtn.addEventListener('click', () => {
      state.scratchOpen = !state.scratchOpen;
      saveState();
      render();
    });
    header.appendChild(scratchBtn);
    root.appendChild(header);
    // The header can wrap to two rows on narrow windows; pin its real height
    // into --header-h so the sticky rail and the fullscreen pad offset correctly.
    // Measured after insertion — offsetHeight is 0 on a detached node.
    syncHeaderHeight(header);

    const shellClass =
      'app-shell' + (showScratch && wideScratch ? ' scratch-open' : '');
    const shell = el('div', { className: shellClass });
    renderRail(shell);
    const panel = el('main', { className: 'panel' });
    let scratchMountPt = null;

    if (showScratch && !wideScratch) {
      scratchMountPt = buildScratchBlock(panel);
    }

    if (view.kind === 'overview') renderOverview(panel);
    else if (view.kind === 'module') {
      const mod = COURSE.modules.find((m) => m.id === view.id);
      if (mod) renderModule(mod, panel);
    } else if (view.kind === 'review') renderReview(panel);
    else if (view.kind === 'log') renderErrorLog(panel);
    else if (view.kind === 'drill') renderDrill(panel);

    shell.appendChild(panel);
    if (showScratch && wideScratch) {
      scratchMountPt = buildScratchColumn(shell);
    }
    root.appendChild(shell);

    if (scratchMountPt) {
      attachScratchMount(scratchMountPt, padKey);
    }
  }

  loadState();
  window
    .matchMedia('(min-width: 1200px)')
    .addEventListener('change', () => render());
  render();
})();