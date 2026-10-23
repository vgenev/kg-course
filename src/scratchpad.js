(function () {
  const STORAGE_KEY = 'kg-course-scratch-v1';
  let scratchPersistOk = true;
  const pads = {};
  const history = {};
  let nextNodeId = 1;
  let nextTextId = 1;

  function emptyPad() {
    return { strokes: [], nodes: [], edges: [], texts: [] };
  }

  function loadPads() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          for (const [k, v] of Object.entries(parsed)) {
            if (v && typeof v === 'object') {
              pads[k] = {
                strokes: Array.isArray(v.strokes) ? v.strokes : [],
                nodes: Array.isArray(v.nodes) ? v.nodes : [],
                edges: Array.isArray(v.edges) ? v.edges : [],
                texts: Array.isArray(v.texts) ? v.texts : [],
              };
              history[k] = [];
              for (const n of pads[k].nodes) {
                const m = /^n(\d+)$/.exec(n.id);
                if (m) nextNodeId = Math.max(nextNodeId, parseInt(m[1], 10) + 1);
              }
              for (const t of pads[k].texts) {
                const m = /^t(\d+)$/.exec(t.id);
                if (m) nextTextId = Math.max(nextTextId, parseInt(m[1], 10) + 1);
              }
            }
          }
        }
      }
    } catch (_) {
      scratchPersistOk = false;
    }
  }

  function savePads() {
    if (!scratchPersistOk) return false;
    try {
      const out = {};
      for (const [k, v] of Object.entries(pads)) {
        out[k] = {
          strokes: v.strokes,
          nodes: v.nodes,
          edges: v.edges,
          texts: v.texts,
        };
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
      return true;
    } catch (_) {
      scratchPersistOk = false;
      return false;
    }
  }

  function padData(key) {
    if (!pads[key]) {
      pads[key] = emptyPad();
      history[key] = [];
    }
    if (!history[key]) history[key] = [];
    if (!Array.isArray(pads[key].texts)) pads[key].texts = [];
    return pads[key];
  }

  function pushHistory(key, entry) {
    history[key].push(entry);
  }

  function readThemeColors() {
    const s = getComputedStyle(document.documentElement);
    return {
      ink: s.getPropertyValue('--text').trim(),
      accent: s.getPropertyValue('--accent').trim(),
      muted: s.getPropertyValue('--text-muted').trim(),
      bg: s.getPropertyValue('--bg').trim(),
      border: s.getPropertyValue('--border').trim(),
      panel: s.getPropertyValue('--panel').trim(),
    };
  }

  function handStack() {
    const s = getComputedStyle(document.documentElement);
    const hand = s.getPropertyValue('--hand').trim();
    return hand || 'cursive';
  }

  function padFont(px) {
    return px + 'px ' + handStack();
  }

  function monoStack() {
    const s = getComputedStyle(document.documentElement);
    return s.getPropertyValue('--mono').trim() || 'monospace';
  }

  /* One line of text is a handwritten note; several lines are pasted data
     (a table of entities, a triple list) and must keep its columns aligned. */
  function isDataText(label) {
    return /\n/.test(label || '') || /\S {2,}\S/.test(label || '');
  }

  function textFontFor(label, size) {
    return isDataText(label)
      ? size - 1 + 'px ' + monoStack()
      : padFont(size);
  }

  function textLineHeight(label) {
    return isDataText(label) ? 18 : 20;
  }

  function shadowColor() {
    const s = getComputedStyle(document.documentElement);
    return s.getPropertyValue('--paper-shadow').trim() || 'rgba(65,64,62,0.28)';
  }

  /* A node is a paper card: offset shadow, panel fill, 2px ink border.
     Corner radii vary slightly per node so a row of them reads hand-cut
     rather than machine-rounded. */
  function nodeCard(ctx2, x, y, w, h, colors, seed) {
    const r = 5 + ((seed || 0) % 3);
    ctx2.save();
    ctx2.fillStyle = shadowColor();
    roundRectPath(ctx2, x + 2, y + 3, w, h, r + 1);
    ctx2.fill();
    ctx2.fillStyle = colors.panel;
    roundRectPath(ctx2, x, y, w, h, r);
    ctx2.fill();
    ctx2.strokeStyle = colors.ink;
    ctx2.lineWidth = 2;
    roundRectPath(ctx2, x, y, w, h, r);
    ctx2.stroke();
    ctx2.restore();
  }

  function roundRectPath(ctx2, x, y, w, h, r) {
    ctx2.beginPath();
    ctx2.moveTo(x + r, y);
    ctx2.lineTo(x + w - r, y);
    ctx2.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx2.lineTo(x + w, y + h - r);
    ctx2.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx2.lineTo(x + r, y + h);
    ctx2.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx2.lineTo(x, y + r);
    ctx2.quadraticCurveTo(x, y, x + r, y);
    ctx2.closePath();
  }

  /* Edges are drawn with a blue-pen waver: a shallow sine offset along the
     shaft, so a straight edge looks hand-ruled instead of vector-perfect. */
  function penLine(ctx2, x1, y1, x2, y2, color, width) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const steps = Math.max(2, Math.min(24, Math.round(len / 14)));
    const amp = Math.min(1.4, len / 90);
    ctx2.strokeStyle = color;
    ctx2.lineWidth = width;
    ctx2.lineCap = 'round';
    ctx2.lineJoin = 'round';
    ctx2.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const wobble = Math.sin(t * Math.PI * 2.2) * amp;
      const x = x1 + dx * t + nx * wobble;
      const y = y1 + dy * t + ny * wobble;
      if (i === 0) ctx2.moveTo(x, y); else ctx2.lineTo(x, y);
    }
    ctx2.stroke();
  }

  function colorForToken(colors, token) {
    if (token === 'accent') return colors.accent;
    if (token === 'muted') return colors.muted;
    return colors.ink;
  }

  function segmentBoxHits(ax, ay, bx, by, rect) {
    const dx = bx - ax;
    const dy = by - ay;
    const { left, right, top, bottom } = rect;
    const eps = 1e-6;
    const hits = [];
    function add(t) {
      if (t < -eps || t > 1 + eps) return;
      const x = ax + t * dx;
      const y = ay + t * dy;
      if (
        x >= left - eps &&
        x <= right + eps &&
        y >= top - eps &&
        y <= bottom + eps
      ) {
        hits.push({ t: Math.max(0, Math.min(1, t)), x, y });
      }
    }
    if (Math.abs(dx) > 1e-9) {
      add((left - ax) / dx);
      add((right - ax) / dx);
    }
    if (Math.abs(dy) > 1e-9) {
      add((top - ay) / dy);
      add((bottom - ay) / dy);
    }
    hits.sort((a, b) => a.t - b.t);
    const uniq = [];
    for (const h of hits) {
      if (
        !uniq.length ||
        Math.hypot(h.x - uniq[uniq.length - 1].x, h.y - uniq[uniq.length - 1].y) >
          0.5
      ) {
        uniq.push(h);
      }
    }
    return uniq;
  }

  function boxExitToward(ax, ay, bx, by, rect) {
    const hits = segmentBoxHits(ax, ay, bx, by, rect);
    if (!hits.length) return { x: ax, y: ay };
    const inside =
      ax >= rect.left &&
      ax <= rect.right &&
      ay >= rect.top &&
      ay <= rect.bottom;
    if (inside) {
      for (const h of hits) {
        if (h.t > 1e-5) return h;
      }
      return hits[hits.length - 1];
    }
    return hits[0];
  }

  function boxEntryToward(ax, ay, bx, by, rect) {
    const hits = segmentBoxHits(ax, ay, bx, by, rect);
    if (!hits.length) return { x: bx, y: by };
    return hits[0];
  }


  /* Hand-drawn icon set: 1.7px stroke, round caps, no fills. Sized by CSS. */
  const ICONS = {
    pen: '<path d="M3.2 15.2 4.4 11 12.9 2.5a1.7 1.7 0 0 1 2.4 2.4L6.8 13.4 3.2 15.2Z"/><path d="M11.6 3.8 14.6 6.8"/>',
    node: '<rect x="3.2" y="5" width="11.6" height="8" rx="2.2"/><path d="M6.4 9h5.2"/>',
    edge: '<circle cx="4.6" cy="13.4" r="1.9"/><circle cx="13.4" cy="4.6" r="1.9"/><path d="M6.2 11.8 11.8 6.2"/>',
    text: '<path d="M3.8 5h10.4"/><path d="M9 5v10.2"/><path d="M6.6 15.2h4.8"/>',
    eraser: '<path d="M4.2 12.1 11 5.3a1.6 1.6 0 0 1 2.3 0l1.4 1.4a1.6 1.6 0 0 1 0 2.3l-5 5H6.4L4.2 12.1Z"/><path d="M7.4 8.9 11.9 13.4"/><path d="M5 15.6h10"/>',
    undo: '<path d="M4.4 8.9a5.6 5.6 0 1 1 1.5 5.4"/><path d="M4.2 4.2v4.9h4.9"/>',
    clear: '<path d="M3.8 5.6h10.4"/><path d="M7.4 5.6V3.9h3.2v1.7"/><path d="M5.6 5.6 6.4 15h5.2l.8-9.4"/>',
    save: '<path d="M9 3.2v7.6"/><path d="M5.8 8 9 11.2 12.2 8"/><path d="M4 14.4h10"/>',
    expand: '<path d="M4 7.2V4h3.2"/><path d="M14 7.2V4h-3.2"/><path d="M4 10.8V14h3.2"/><path d="M14 10.8V14h-3.2"/>',
    collapse: '<path d="M7.2 4v3.2H4"/><path d="M10.8 4v3.2H14"/><path d="M7.2 14v-3.2H4"/><path d="M10.8 14v-3.2H14"/>',
  };

  function iconSvg(name) {
    return (
      '<svg viewBox="0 0 18 18" aria-hidden="true" focusable="false" fill="none" ' +
      'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      (ICONS[name] || '') +
      '</svg>'
    );
  }

  function mount(container, padKey) {
    container.innerHTML = '';
    const data = padData(padKey);
    const colors = readThemeColors();

    let tool = 'pen';
    let colorToken = 'ink';
    let drawing = false;
    let currentStroke = null;
    let edgeDrag = null;
    let nodeDrag = null;
    let textDrag = null;
    let inlineInput = null;
    let eraserHover = null;

    const wrap = document.createElement('div');
    wrap.className = 'scratch-widget';

    const toolbar = document.createElement('div');
    toolbar.className = 'scratch-toolbar';

    const persistNote = document.createElement('p');
    persistNote.className = 'scratch-persist-note';
    persistNote.hidden = true;
    persistNote.textContent = 'Scratchpad will not persist here';

    function showPersistFail() {
      persistNote.hidden = false;
    }

    function setTool(t) {
      tool = t;
      eraserHover = null;
      toolbar.querySelectorAll('[data-tool]').forEach((btn) => {
        btn.setAttribute(
          'aria-pressed',
          btn.getAttribute('data-tool') === t ? 'true' : 'false'
        );
      });
    }

    function makeToolBtn(icon, t, label) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'scratch-tool-btn';
      b.innerHTML = iconSvg(icon);
      b.setAttribute('data-tool', t);
      b.setAttribute('aria-label', label);
      b.setAttribute('title', label);
      b.setAttribute('aria-pressed', t === tool ? 'true' : 'false');
      b.addEventListener('click', () => setTool(t));
      return b;
    }

    toolbar.appendChild(makeToolBtn('pen', 'pen', 'Pen'));
    toolbar.appendChild(makeToolBtn('node', 'node', 'Node'));
    toolbar.appendChild(makeToolBtn('edge', 'edge', 'Edge'));
    toolbar.appendChild(makeToolBtn('text', 'text', 'Text'));
    toolbar.appendChild(makeToolBtn('eraser', 'eraser', 'Eraser'));

    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'scratch-tool-btn';
    undoBtn.innerHTML = iconSvg('undo');
    undoBtn.setAttribute('aria-label', 'Undo');
    undoBtn.setAttribute('title', 'Undo');
    undoBtn.addEventListener('click', () => {
      const hist = history[padKey];
      if (!hist.length) return;
      const last = hist.pop();
      if (last.type === 'stroke') {
        data.strokes.pop();
      } else if (last.type === 'node') {
        data.nodes = data.nodes.filter((n) => n.id !== last.id);
        data.edges = data.edges.filter(
          (e) => e.from !== last.id && e.to !== last.id
        );
      } else if (last.type === 'edge') {
        data.edges.pop();
      } else if (last.type === 'text') {
        data.texts = data.texts.filter((t) => t.id !== last.id);
      } else if (last.type === 'move') {
        const item =
          last.kind === 'node'
            ? data.nodes.find((n) => n.id === last.id)
            : data.texts.find((t) => t.id === last.id);
        if (item) {
          item.x = last.x;
          item.y = last.y;
        }
      }
      savePads() || showPersistFail();
      redraw();
    });
    toolbar.appendChild(undoBtn);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'scratch-tool-btn';
    clearBtn.innerHTML = iconSvg('clear');
    clearBtn.setAttribute('aria-label', 'Clear pad');
    clearBtn.setAttribute('title', 'Clear pad');
    clearBtn.addEventListener('click', () => {
      if (!confirm('Clear this scratchpad?')) return;
      data.strokes = [];
      data.nodes = [];
      data.edges = [];
      data.texts = [];
      history[padKey] = [];
      savePads() || showPersistFail();
      redraw();
    });
    toolbar.appendChild(clearBtn);

    const swatchRow = document.createElement('div');
    swatchRow.className = 'scratch-swatches';
    for (const token of ['ink', 'accent', 'muted']) {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'scratch-swatch scratch-swatch-' + token;
      sw.title = token;
      sw.setAttribute('aria-pressed', token === colorToken ? 'true' : 'false');
      sw.addEventListener('click', () => {
        colorToken = token;
        swatchRow.querySelectorAll('.scratch-swatch').forEach((s) => {
          s.setAttribute(
            'aria-pressed',
            s.classList.contains('scratch-swatch-' + token) ? 'true' : 'false'
          );
        });
      });
      swatchRow.appendChild(sw);
    }
    toolbar.appendChild(swatchRow);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'scratch-tool-btn';
    saveBtn.innerHTML = iconSvg('save');
    saveBtn.setAttribute('aria-label', 'Save as PNG');
    saveBtn.setAttribute('title', 'Save as PNG');
    saveBtn.addEventListener('click', () => savePng(padKey));
    toolbar.appendChild(saveBtn);

    // Draw on the whole screen: the pad becomes a fixed overlay over the page.
    // Handy with a stylus or a finger on a tablet, where a 430px panel is tiny.
    const fsBtn = document.createElement('button');
    fsBtn.type = 'button';
    fsBtn.className = 'scratch-tool-btn scratch-fs-btn';
    fsBtn.innerHTML = iconSvg('expand');
    fsBtn.setAttribute('aria-label', 'Full screen');
    fsBtn.setAttribute('title', 'Full screen (Esc to leave)');
    fsBtn.setAttribute('aria-pressed', 'false');
    fsBtn.addEventListener('click', () => toggleFullscreen());
    toolbar.appendChild(fsBtn);

    function isFullscreen() {
      return wrap.classList.contains('scratch-full');
    }

    function toggleFullscreen(force) {
      const next = typeof force === 'boolean' ? force : !isFullscreen();
      wrap.classList.toggle('scratch-full', next);
      document.body.classList.toggle('scratch-lock', next);
      fsBtn.innerHTML = iconSvg(next ? 'collapse' : 'expand');
      fsBtn.setAttribute('aria-label', next ? 'Exit full screen' : 'Full screen');
      fsBtn.setAttribute('title', next ? 'Exit full screen (Esc)' : 'Full screen');
      fsBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
      // The class landed synchronously, so the wrap already has its new box:
      // measure now, then once more after the frame in case a scrollbar moved.
      resize();
      redraw();
      requestAnimationFrame(() => {
        resize();
        redraw();
      });
    }

    function onFsKey(ev) {
      if (ev.key === 'Escape' && isFullscreen()) {
        ev.preventDefault();
        toggleFullscreen(false);
      }
    }
    document.addEventListener('keydown', onFsKey);

    toolbar.appendChild(persistNote);

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'scratch-canvas-wrap';

    const canvas = document.createElement('canvas');
    canvas.className = 'scratch-canvas';
    canvasWrap.appendChild(canvas);

    wrap.appendChild(toolbar);
    wrap.appendChild(canvasWrap);
    container.appendChild(wrap);

    const ctx = canvas.getContext('2d');
    let cssW = 0;
    let cssH = 0;

    function canvasPoint(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      const x = (clientX - r.left) / r.width;
      const y = (clientY - r.top) / r.height;
      return {
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
      };
    }

    function px(nx, ny) {
      return { x: nx * cssW, y: ny * cssH };
    }

    function nodeAt(nx, ny) {
      const hit = 0.055;
      for (let i = data.nodes.length - 1; i >= 0; i--) {
        const n = data.nodes[i];
        const dx = nx - n.x;
        const dy = ny - n.y;
        if (dx * dx + dy * dy <= hit * hit) return n;
      }
      return null;
    }

    function measureNode(ctx2, label) {
      ctx2.font = padFont(15);
      const tw = ctx2.measureText(label).width;
      const w = Math.max(tw + 22, 46);
      const h = 30;
      return { w, h };
    }

    function drawNode(ctx2, n, theme) {
      const p = px(n.x, n.y);
      const { w, h } = measureNode(ctx2, n.label || '');
      const x = p.x - w / 2;
      const y = p.y - h / 2;
      const seed = (n.id || '').replace(/\D/g, '') | 0;
      nodeCard(ctx2, x, y, w, h, theme, seed);
      ctx2.font = padFont(15);
      ctx2.fillStyle = theme.ink;
      ctx2.textAlign = 'center';
      ctx2.textBaseline = 'middle';
      ctx2.fillText(n.label || '', p.x, p.y + 1);
    }

    function roundRect(ctx2, x, y, w, h, r) {
      ctx2.beginPath();
      ctx2.moveTo(x + r, y);
      ctx2.lineTo(x + w - r, y);
      ctx2.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx2.lineTo(x + w, y + h - r);
      ctx2.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx2.lineTo(x + r, y + h);
      ctx2.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx2.lineTo(x, y + r);
      ctx2.quadraticCurveTo(x, y, x + r, y);
      ctx2.closePath();
    }

    function nodeRectPx(n, ctx2) {
      const p = px(n.x, n.y);
      const { w, h } = measureNode(ctx2, n.label || '');
      return {
        cx: p.x,
        cy: p.y,
        w,
        h,
        left: p.x - w / 2,
        right: p.x + w / 2,
        top: p.y - h / 2,
        bottom: p.y + h / 2,
      };
    }

    function computeEdgeGeom(from, to, ctx2) {
      const a = px(from.x, from.y);
      const b = px(to.x, to.y);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const srcRect = nodeRectPx(from, ctx2);
      const tgtRect = nodeRectPx(to, ctx2);
      const start = boxExitToward(a.x, a.y, b.x, b.y, srcRect);
      const entry = boxEntryToward(a.x, a.y, b.x, b.y, tgtRect);
      const outNx = entry.x - tgtRect.cx;
      const outNy = entry.y - tgtRect.cy;
      const outLen = Math.hypot(outNx, outNy) || 1;
      const midX = (start.x + entry.x) / 2;
      const midY = (start.y + entry.y) / 2;
      const entryAlong = (entry.x - start.x) * ux + (entry.y - start.y) * uy;
      let tipX = entry.x + (outNx / outLen) * 3;
      let tipY = entry.y + (outNy / outLen) * 3;
      const headLen = 9;
      // Only clamp when the visible gap cannot hold a head; otherwise the head
      // lands at the midpoint of every edge, which reads as no arrow at all.
      if (entryAlong <= headLen + 2 || entryAlong > len) {
        tipX = midX;
        tipY = midY;
      }
      const lineEndX = tipX - ux * headLen;
      const lineEndY = tipY - uy * headLen;
      return {
        x1: start.x,
        y1: start.y,
        x2: lineEndX,
        y2: lineEndY,
        tipX,
        tipY,
        ux,
        uy,
        a,
        b,
      };
    }

    function drawEdgeShaft(ctx2, e, theme) {
      const from = data.nodes.find((n) => n.id === e.from);
      const to = data.nodes.find((n) => n.id === e.to);
      if (!from || !to) return;
      const g = computeEdgeGeom(from, to, ctx2);
      penLine(ctx2, g.x1, g.y1, g.x2, g.y2, theme.accent, 1.8);
      if (e.label) {
        const mx = (g.a.x + g.b.x) / 2;
        const my = (g.a.y + g.b.y) / 2;
        const off = 12;
        const lx = mx + (-g.uy) * off;
        const ly = my + g.ux * off;
        ctx2.font = padFont(14);
        ctx2.textAlign = 'center';
        ctx2.textBaseline = 'middle';
        ctx2.fillStyle = theme.accent;
        ctx2.fillText(e.label, lx, ly);
      }
    }

    function drawEdgeHead(ctx2, e, theme) {
      const from = data.nodes.find((n) => n.id === e.from);
      const to = data.nodes.find((n) => n.id === e.to);
      if (!from || !to) return;
      const g = computeEdgeGeom(from, to, ctx2);
      const { tipX, tipY, ux, uy } = g;
      const headLen = 9;
      const halfW = 4.5;
      const bx = tipX - ux * headLen;
      const by = tipY - uy * headLen;
      ctx2.fillStyle = theme.accent;
      ctx2.beginPath();
      ctx2.moveTo(tipX, tipY);
      ctx2.lineTo(bx + (-uy) * halfW, by + ux * halfW);
      ctx2.lineTo(bx - (-uy) * halfW, by - ux * halfW);
      ctx2.closePath();
      ctx2.fill();
    }

    function drawTextAnn(ctx2, t, theme) {
      const p = px(t.x, t.y);
      const label = t.label || '';
      const lines = label.split('\n');
      const lh = textLineHeight(label);
      ctx2.font = textFontFor(label, 15);
      ctx2.fillStyle = theme.ink;
      ctx2.textAlign = 'left';
      ctx2.textBaseline = 'top';
      lines.forEach((ln, i) => ctx2.fillText(ln, p.x, p.y + i * lh));
    }

    function textBoundsPx(t, ctx2) {
      const p = px(t.x, t.y);
      const label = t.label || '';
      const lines = label.split('\n');
      const lh = textLineHeight(label);
      ctx2.font = textFontFor(label, 15);
      const tw = Math.max.apply(
        null,
        lines.map((ln) => ctx2.measureText(ln).width)
      );
      const pad = 4;
      return {
        left: p.x - pad,
        right: p.x + tw + pad,
        top: p.y - pad,
        bottom: p.y + (lines.length - 1) * lh + lh - 2,
      };
    }

    function textAtNorm(nx, ny) {
      for (let i = data.texts.length - 1; i >= 0; i--) {
        const t = data.texts[i];
        const b = textBoundsPx(t, ctx);
        const px = nx * cssW;
        const py = ny * cssH;
        if (px >= b.left && px <= b.right && py >= b.top && py <= b.bottom) {
          return t;
        }
      }
      return null;
    }

    function distPointSeg(pxx, pyy, x1, y1, x2, y2) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-9) return Math.hypot(pxx - x1, pyy - y1);
      let t = ((pxx - x1) * dx + (pyy - y1) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const qx = x1 + t * dx;
      const qy = y1 + t * dy;
      return Math.hypot(pxx - qx, pyy - qy);
    }

    function hitTestEraser(nx, ny) {
      const pxx = nx * cssW;
      const pyy = ny * cssH;
      const t = textAtNorm(nx, ny);
      if (t) return { kind: 'text', id: t.id, ref: t };
      const n = nodeAt(nx, ny);
      if (n) return { kind: 'node', id: n.id, ref: n };
      for (let i = data.edges.length - 1; i >= 0; i--) {
        const e = data.edges[i];
        const from = data.nodes.find((nd) => nd.id === e.from);
        const to = data.nodes.find((nd) => nd.id === e.to);
        if (!from || !to) continue;
        const g = computeEdgeGeom(from, to, ctx);
        const d = distPointSeg(pxx, pyy, g.x1, g.y1, g.tipX, g.tipY);
        if (d <= 8) return { kind: 'edge', index: i, ref: e };
      }
      for (let i = data.strokes.length - 1; i >= 0; i--) {
        const s = data.strokes[i];
        if (!s.pts || s.pts.length < 2) continue;
        for (let j = 1; j < s.pts.length; j++) {
          const a = px(s.pts[j - 1][0], s.pts[j - 1][1]);
          const b = px(s.pts[j][0], s.pts[j][1]);
          if (distPointSeg(pxx, pyy, a.x, a.y, b.x, b.y) <= 6) {
            return { kind: 'stroke', index: i, ref: s };
          }
        }
      }
      return null;
    }

    function deleteEraserTarget(target) {
      if (!target) return;
      if (target.kind === 'text') {
        data.texts = data.texts.filter((t) => t.id !== target.id);
      } else if (target.kind === 'node') {
        data.nodes = data.nodes.filter((n) => n.id !== target.id);
        data.edges = data.edges.filter(
          (e) => e.from !== target.id && e.to !== target.id
        );
      } else if (target.kind === 'edge') {
        data.edges.splice(target.index, 1);
      } else if (target.kind === 'stroke') {
        data.strokes.splice(target.index, 1);
      }
    }

    function drawEraserHover(ctx2, target, theme) {
      if (!target) return;
      ctx2.strokeStyle = theme.accent;
      ctx2.lineWidth = 1;
      if (target.kind === 'text') {
        const b = textBoundsPx(target.ref, ctx2);
        ctx2.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
      } else if (target.kind === 'node') {
        const r = nodeRectPx(target.ref, ctx2);
        ctx2.strokeRect(r.left, r.top, r.w, r.h);
      } else if (target.kind === 'edge') {
        const from = data.nodes.find((n) => n.id === target.ref.from);
        const to = data.nodes.find((n) => n.id === target.ref.to);
        if (!from || !to) return;
        const g = computeEdgeGeom(from, to, ctx2);
        ctx2.beginPath();
        ctx2.moveTo(g.x1, g.y1);
        ctx2.lineTo(g.tipX, g.tipY);
        ctx2.stroke();
      } else if (target.kind === 'stroke') {
        const s = target.ref;
        if (!s.pts || s.pts.length < 2) return;
        ctx2.lineCap = 'round';
        ctx2.lineJoin = 'round';
        ctx2.beginPath();
        const first = px(s.pts[0][0], s.pts[0][1]);
        ctx2.moveTo(first.x, first.y);
        for (let i = 1; i < s.pts.length; i++) {
          const p = px(s.pts[i][0], s.pts[i][1]);
          ctx2.lineTo(p.x, p.y);
        }
        ctx2.stroke();
      }
    }

    function drawStroke(ctx2, stroke, theme) {
      if (!stroke.pts || stroke.pts.length < 2) return;
      ctx2.strokeStyle = colorForToken(theme, stroke.c);
      ctx2.lineWidth = 2.5;
      ctx2.lineCap = 'round';
      ctx2.lineJoin = 'round';
      ctx2.beginPath();
      const first = px(stroke.pts[0][0], stroke.pts[0][1]);
      ctx2.moveTo(first.x, first.y);
      for (let i = 1; i < stroke.pts.length; i++) {
        const p = px(stroke.pts[i][0], stroke.pts[i][1]);
        ctx2.lineTo(p.x, p.y);
      }
      ctx2.stroke();
    }

    function redraw() {
      if (cssW <= 0 || cssH <= 0 || canvas.width <= 0 || canvas.height <= 0) {
        return;
      }
      const theme = readThemeColors();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const scale = canvas.width / cssW;
      ctx.scale(scale, scale);
      for (const s of data.strokes) drawStroke(ctx, s, theme);
      for (const e of data.edges) drawEdgeShaft(ctx, e, theme);
      for (const n of data.nodes) drawNode(ctx, n, theme);
      for (const t of data.texts) drawTextAnn(ctx, t, theme);
      for (const e of data.edges) drawEdgeHead(ctx, e, theme);
      if (eraserHover) drawEraserHover(ctx, eraserHover, theme);
      if (currentStroke && currentStroke.pts.length) {
        drawStroke(ctx, currentStroke, theme);
      }
      if (edgeDrag) {
        const theme2 = readThemeColors();
        ctx.strokeStyle = theme2.muted;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        const a = px(edgeDrag.from.x, edgeDrag.from.y);
        const b = px(edgeDrag.x, edgeDrag.y);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    let resizeRaf = 0;

    function scheduleResize() {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        resize();
      });
    }

    function resize() {
      const newW = canvasWrap.clientWidth;
      const newH = canvasWrap.clientHeight;
      if (newW <= 0 || newH <= 0) {
        scheduleResize();
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      const newCw = Math.round(newW * dpr);
      const newCh = Math.round(newH * dpr);
      if (
        Math.abs(newW - cssW) < 0.5 &&
        Math.abs(newH - cssH) < 0.5 &&
        canvas.width === newCw &&
        canvas.height === newCh
      ) {
        return;
      }
      cssW = newW;
      cssH = newH;
      canvas.width = newCw;
      canvas.height = newCh;
      canvas.style.width = newW + 'px';
      canvas.style.height = newH + 'px';
      redraw();
    }

    function removeInlineInput() {
      if (inlineInput && inlineInput.parentNode) {
        inlineInput.parentNode.removeChild(inlineInput);
      }
      inlineInput = null;
    }

    function showInlineInput(clientX, clientY, initial, onCommit, onCancel, opts) {
      opts = opts || {};
      removeInlineInput();
      const box = document.createElement('div');
      box.className = 'scratch-inline-input' + (opts.multiline ? ' is-multiline' : '');
      const r = canvasWrap.getBoundingClientRect();
      box.style.left = clientX - r.left + 'px';
      box.style.top = clientY - r.top + 'px';
      const inp = document.createElement(opts.multiline ? 'textarea' : 'input');
      if (!opts.multiline) inp.type = 'text';
      inp.value = initial || '';
      inp.setAttribute('aria-label', opts.multiline ? 'Text note' : 'Label');
      if (opts.multiline) {
        inp.rows = 3;
        inp.spellcheck = false;
        inp.placeholder = 'paste or type, Enter for a new line, Cmd+Enter to place';
        const grow = () => {
          inp.rows = Math.min(14, Math.max(3, inp.value.split('\n').length + 1));
        };
        inp.addEventListener('input', grow);
        grow();
      }
      box.appendChild(inp);
      canvasWrap.appendChild(box);
      inlineInput = box;
      inp.focus();
      try {
        inp.setSelectionRange(inp.value.length, inp.value.length);
      } catch (_) {}

      function clean(raw) {
        // Keep leading spaces and inner alignment: a pasted table loses its
        // columns if the value is trimmed like a one-word node label.
        const lines = raw.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
        while (lines.length && !lines[lines.length - 1]) lines.pop();
        while (lines.length && !lines[0]) lines.shift();
        return lines.join('\n');
      }

      function commit() {
        const v = clean(inp.value);
        removeInlineInput();
        if (v.trim()) onCommit(v);
        else if (onCancel) onCancel();
      }

      inp.addEventListener('keydown', (ev) => {
        const cmdEnter = ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey);
        if (ev.key === 'Escape') {
          ev.preventDefault();
          removeInlineInput();
          if (onCancel) onCancel();
          return;
        }
        if (cmdEnter || (ev.key === 'Enter' && !opts.multiline)) {
          ev.preventDefault();
          commit();
        }
      });
      inp.addEventListener('blur', () => {
        setTimeout(() => {
          if (inlineInput === box) commit();
        }, 120);
      });
    }

    function persist() {
      if (!savePads()) showPersistFail();
    }

    canvas.addEventListener('pointerdown', (ev) => {
      if (inlineInput) return;
      const pt = canvasPoint(ev.clientX, ev.clientY);

      if (tool === 'pen') {
        canvas.setPointerCapture(ev.pointerId);
        drawing = true;
        currentStroke = { c: colorToken, pts: [[pt.x, pt.y]] };
        redraw();
      } else if (tool === 'node') {
        const hit = nodeAt(pt.x, pt.y);
        const hitText = hit ? null : textAtNorm(pt.x, pt.y);
        if (hit) {
          canvas.setPointerCapture(ev.pointerId);
          nodeDrag = {
            id: hit.id,
            startX: pt.x,
            startY: pt.y,
            sx: hit.x,
            sy: hit.y,
            moved: false,
          };
        } else if (hitText) {
          canvas.setPointerCapture(ev.pointerId);
          textDrag = {
            kind: 'text',
            id: hitText.id,
            dx: hitText.x - pt.x,
            dy: hitText.y - pt.y,
            startX: pt.x,
            startY: pt.y,
            sx: hitText.x,
            sy: hitText.y,
            moved: false,
          };
        } else {
          const clickX = ev.clientX;
          const clickY = ev.clientY;
          const nx = pt.x;
          const ny = pt.y;
          setTimeout(() => {
            showInlineInput(
              clickX,
              clickY,
              '',
              (label) => {
                const id = 'n' + nextNodeId++;
                data.nodes.push({ id, x: nx, y: ny, label });
                pushHistory(padKey, { type: 'node', id });
                persist();
                redraw();
              },
              () => redraw()
            );
          }, 0);
        }
      } else if (tool === 'edge') {
        const hit = nodeAt(pt.x, pt.y);
        if (hit) {
          canvas.setPointerCapture(ev.pointerId);
          edgeDrag = { fromId: hit.id, from: hit, x: pt.x, y: pt.y };
        }
      } else if (tool === 'text') {
        const hitText = textAtNorm(pt.x, pt.y);
        const hitNode = hitText ? null : nodeAt(pt.x, pt.y);
        if (hitText || hitNode) {
          canvas.setPointerCapture(ev.pointerId);
          textDrag = {
            kind: hitText ? 'text' : 'node',
            id: (hitText || hitNode).id,
            dx: (hitText || hitNode).x - pt.x,
            dy: (hitText || hitNode).y - pt.y,
            startX: pt.x,
            startY: pt.y,
            sx: (hitText || hitNode).x,
            sy: (hitText || hitNode).y,
            moved: false,
          };
        } else {
          const clickX = ev.clientX;
          const clickY = ev.clientY;
          const nx = pt.x;
          const ny = pt.y;
          setTimeout(() => {
            showInlineInput(
              clickX,
              clickY,
              '',
              (label) => {
                const id = 't' + nextTextId++;
                data.texts.push({ id, x: nx, y: ny, label });
                pushHistory(padKey, { type: 'text', id });
                persist();
                redraw();
              },
              () => redraw(),
              { multiline: true }
            );
          }, 0);
        }
      } else if (tool === 'eraser') {
        const target = hitTestEraser(pt.x, pt.y);
        if (target) {
          deleteEraserTarget(target);
          eraserHover = null;
          persist();
          redraw();
        }
      }
    });

    canvas.addEventListener('pointermove', (ev) => {
      const pt = canvasPoint(ev.clientX, ev.clientY);
      if (tool === 'pen' && drawing && currentStroke) {
        const pts = currentStroke.pts;
        const last = pts[pts.length - 1];
        if (
          Math.hypot(pt.x - last[0], pt.y - last[1]) >
          0.002
        ) {
          pts.push([pt.x, pt.y]);
          redraw();
        }
      } else if (nodeDrag) {
        const n = data.nodes.find((x) => x.id === nodeDrag.id);
        if (n) {
          if (
            Math.hypot(pt.x - nodeDrag.startX, pt.y - nodeDrag.startY) > 0.01
          ) {
            nodeDrag.moved = true;
          }
          if (nodeDrag.moved) {
            n.x = pt.x;
            n.y = pt.y;
            redraw();
          }
        }
      } else if (textDrag) {
        if (Math.hypot(pt.x - textDrag.startX, pt.y - textDrag.startY) > 0.008) {
          textDrag.moved = true;
        }
        if (textDrag.moved) {
          const item =
            textDrag.kind === 'text'
              ? data.texts.find((t2) => t2.id === textDrag.id)
              : data.nodes.find((n2) => n2.id === textDrag.id);
          if (item) {
            item.x = pt.x + textDrag.dx;
            item.y = pt.y + textDrag.dy;
            redraw();
          }
        }
      } else if (tool === 'edge' && edgeDrag) {
        edgeDrag.x = pt.x;
        edgeDrag.y = pt.y;
        redraw();
      } else if (tool === 'eraser') {
        eraserHover = hitTestEraser(pt.x, pt.y);
        redraw();
      } else if (tool === 'node' || tool === 'text') {
        const over = nodeAt(pt.x, pt.y) || textAtNorm(pt.x, pt.y);
        canvas.style.cursor = over ? 'grab' : tool === 'text' ? 'text' : 'crosshair';
      }
    });

    canvas.addEventListener('pointerup', (ev) => {
      try {
        canvas.releasePointerCapture(ev.pointerId);
      } catch (_) {}

      if (tool === 'pen' && drawing && currentStroke) {
        if (currentStroke.pts.length >= 2) {
          data.strokes.push(currentStroke);
          pushHistory(padKey, { type: 'stroke' });
          persist();
        }
        currentStroke = null;
        drawing = false;
        redraw();
      } else if (nodeDrag) {
        const d = nodeDrag;
        nodeDrag = null;
        canvas.style.cursor = 'default';
        if (d.moved) {
          pushHistory(padKey, { type: 'move', kind: 'node', id: d.id, x: d.sx, y: d.sy });
          persist();
          redraw();
        } else if (tool === 'node') {
          // A press without movement is a rename, not a drag.
          const n = data.nodes.find((x) => x.id === d.id);
          if (n) {
            const r = canvas.getBoundingClientRect();
            showInlineInput(
              r.left + n.x * r.width,
              r.top + n.y * r.height,
              n.label || '',
              (label) => {
                n.label = label;
                persist();
                redraw();
              },
              () => redraw()
            );
          }
        }
      } else if (textDrag) {
        const d = textDrag;
        textDrag = null;
        canvas.style.cursor = 'default';
        if (d.moved) {
          pushHistory(padKey, { type: 'move', kind: d.kind, id: d.id, x: d.sx, y: d.sy });
          persist();
          redraw();
        } else {
          const item =
            d.kind === 'text'
              ? data.texts.find((t2) => t2.id === d.id)
              : data.nodes.find((n2) => n2.id === d.id);
          if (item) {
            const r = canvas.getBoundingClientRect();
            if (d.kind === 'text') {
              showInlineInput(
                r.left + item.x * r.width,
                r.top + item.y * r.height,
                item.label || '',
                (label) => {
                  item.label = label;
                  persist();
                  redraw();
                },
                () => redraw(),
                { multiline: true }
              );
            } else {
              showInlineInput(
                r.left + item.x * r.width,
                r.top + item.y * r.height,
                item.label || '',
                (label) => {
                  item.label = label;
                  persist();
                  redraw();
                },
                () => redraw()
              );
            }
          }
        }
      } else if (tool === 'edge' && edgeDrag) {
        const pt = canvasPoint(ev.clientX, ev.clientY);
        const target = nodeAt(pt.x, pt.y);
        const fromId = edgeDrag.fromId;
        if (target && target.id !== fromId) {
          const midX = (edgeDrag.from.x + target.x) / 2;
          const midY = (edgeDrag.from.y + target.y) / 2;
          const midClient = {
            x:
              canvas.getBoundingClientRect().left +
              midX * canvas.getBoundingClientRect().width,
            y:
              canvas.getBoundingClientRect().top +
              midY * canvas.getBoundingClientRect().height,
          };
          const pending = { from: fromId, to: target.id };
          const mcx = midClient.x;
          const mcy = midClient.y;
          edgeDrag = null;
          redraw();
          setTimeout(() => {
            showInlineInput(
              mcx,
              mcy,
              '',
              (label) => {
                data.edges.push({ from: pending.from, to: pending.to, label });
                pushHistory(padKey, { type: 'edge' });
                persist();
                redraw();
              },
              () => redraw()
            );
          }, 0);
        } else {
          edgeDrag = null;
          redraw();
        }
      }
    });

    canvas.addEventListener('pointercancel', () => {
      drawing = false;
      currentStroke = null;
      nodeDrag = null;
      textDrag = null;
      edgeDrag = null;
      canvas.style.cursor = 'default';
      redraw();
    });

    const ro = new ResizeObserver(() => scheduleResize());
    ro.observe(canvasWrap);

    if (!scratchPersistOk) showPersistFail();

    resize();
    scheduleResize();

    return function destroy() {
      if (resizeRaf) {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = 0;
      }
      ro.disconnect();
      removeInlineInput();
    };
  }

  function savePng(padKey) {
    const data = padData(padKey);
    const theme = readThemeColors();
    const w = 800;
    const h = 600;
    const scale = 2;
    const off = document.createElement('canvas');
    off.width = w * scale;
    off.height = h * scale;
    const ctx = off.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);

    function px2(nx, ny) {
      return { x: nx * w, y: ny * h };
    }

    function drawStroke2(stroke) {
      if (!stroke.pts || stroke.pts.length < 2) return;
      ctx.strokeStyle = colorForToken(theme, stroke.c);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const first = px2(stroke.pts[0][0], stroke.pts[0][1]);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < stroke.pts.length; i++) {
        const p = px2(stroke.pts[i][0], stroke.pts[i][1]);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }

    function drawNode2(n) {
      const p = px2(n.x, n.y);
      ctx.font = padFont(15);
      const tw = ctx.measureText(n.label || '').width;
      const bw = Math.max(tw + 22, 46);
      const bh = 30;
      const x = p.x - bw / 2;
      const y = p.y - bh / 2;
      const seed = (n.id || '').replace(/\D/g, '') | 0;
      nodeCard(ctx, x, y, bw, bh, theme, seed);
      ctx.font = padFont(15);
      ctx.fillStyle = theme.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n.label || '', p.x, p.y + 1);
    }

    function roundRect(ctx2, x, y, bw, bh, r) {
      ctx2.beginPath();
      ctx2.moveTo(x + r, y);
      ctx2.lineTo(x + bw - r, y);
      ctx2.quadraticCurveTo(x + bw, y, x + bw, y + r);
      ctx2.lineTo(x + bw, y + bh - r);
      ctx2.quadraticCurveTo(x + bw, y + bh, x + bw - r, y + bh);
      ctx2.lineTo(x + r, y + bh);
      ctx2.quadraticCurveTo(x, y + bh, x, y + bh - r);
      ctx2.lineTo(x, y + r);
      ctx2.quadraticCurveTo(x, y, x + r, y);
      ctx2.closePath();
    }

    function nodeRectPx2(n) {
      const p = px2(n.x, n.y);
      ctx.font = padFont(15);
      const tw = ctx.measureText(n.label || '').width;
      const bw = Math.max(tw + 22, 46);
      const bh = 30;
      return {
        cx: p.x,
        cy: p.y,
        left: p.x - bw / 2,
        right: p.x + bw / 2,
        top: p.y - bh / 2,
        bottom: p.y + bh / 2,
      };
    }

    function computeEdgeGeom2(from, to) {
      const a = px2(from.x, from.y);
      const b = px2(to.x, to.y);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const srcRect = nodeRectPx2(from);
      const tgtRect = nodeRectPx2(to);
      const start = boxExitToward(a.x, a.y, b.x, b.y, srcRect);
      const entry = boxEntryToward(a.x, a.y, b.x, b.y, tgtRect);
      const outNx = entry.x - tgtRect.cx;
      const outNy = entry.y - tgtRect.cy;
      const outLen = Math.hypot(outNx, outNy) || 1;
      const midX = (start.x + entry.x) / 2;
      const midY = (start.y + entry.y) / 2;
      const entryAlong = (entry.x - start.x) * ux + (entry.y - start.y) * uy;
      let tipX = entry.x + (outNx / outLen) * 3;
      let tipY = entry.y + (outNy / outLen) * 3;
      const headLen = 9;
      // Only clamp when the visible gap cannot hold a head; otherwise the head
      // lands at the midpoint of every edge, which reads as no arrow at all.
      if (entryAlong <= headLen + 2 || entryAlong > len) {
        tipX = midX;
        tipY = midY;
      }
      return {
        x1: start.x,
        y1: start.y,
        x2: tipX - ux * headLen,
        y2: tipY - uy * headLen,
        tipX,
        tipY,
        ux,
        uy,
        a,
        b,
      };
    }

    function drawEdgeShaft2(e) {
      const from = data.nodes.find((n) => n.id === e.from);
      const to = data.nodes.find((n) => n.id === e.to);
      if (!from || !to) return;
      const g = computeEdgeGeom2(from, to);
      penLine(ctx, g.x1, g.y1, g.x2, g.y2, theme.accent, 1.8);
      if (e.label) {
        const mx = (g.a.x + g.b.x) / 2;
        const my = (g.a.y + g.b.y) / 2;
        const offN = 12;
        ctx.font = padFont(14);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = theme.accent;
        ctx.fillText(e.label, mx + (-g.uy) * offN, my + g.ux * offN);
      }
    }

    function drawEdgeHead2(e) {
      const from = data.nodes.find((n) => n.id === e.from);
      const to = data.nodes.find((n) => n.id === e.to);
      if (!from || !to) return;
      const g = computeEdgeGeom2(from, to);
      const headLen = 9;
      const halfW = 4.5;
      const bx = g.tipX - g.ux * headLen;
      const by = g.tipY - g.uy * headLen;
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.moveTo(g.tipX, g.tipY);
      ctx.lineTo(bx + (-g.uy) * halfW, by + g.ux * halfW);
      ctx.lineTo(bx - (-g.uy) * halfW, by - g.ux * halfW);
      ctx.closePath();
      ctx.fill();
    }

    function drawText2(t) {
      const p = px2(t.x, t.y);
      const label = t.label || '';
      const lines = label.split('\n');
      const lh = textLineHeight(label);
      ctx.font = textFontFor(label, 15);
      ctx.fillStyle = theme.ink;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      lines.forEach((ln, i) => ctx.fillText(ln, p.x, p.y + i * lh));
    }

    for (const s of data.strokes) drawStroke2(s);
    for (const e of data.edges) drawEdgeShaft2(e);
    for (const n of data.nodes) drawNode2(n);
    for (const t of data.texts) drawText2(t);
    for (const e of data.edges) drawEdgeHead2(e);

    off.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'kg-scratch-' + padKey + '.png';
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  }

  loadPads();

  window.KGScratchpad = {
    mount,
    savePng,
    scratchPersistOk: () => scratchPersistOk,
  };
})();