(function () {
  const STORAGE_KEY = 'kg-course-scratch-v1';
  let scratchPersistOk = true;
  const pads = {};
  const history = {};
  let nextNodeId = 1;

  function emptyPad() {
    return { strokes: [], nodes: [], edges: [] };
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
              };
              history[k] = [];
              for (const n of pads[k].nodes) {
                const m = /^n(\d+)$/.exec(n.id);
                if (m) nextNodeId = Math.max(nextNodeId, parseInt(m[1], 10) + 1);
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
        out[k] = { strokes: v.strokes, nodes: v.nodes, edges: v.edges };
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

  function colorForToken(colors, token) {
    if (token === 'accent') return colors.accent;
    if (token === 'muted') return colors.muted;
    return colors.ink;
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
    let inlineInput = null;

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
      toolbar.querySelectorAll('[data-tool]').forEach((btn) => {
        btn.setAttribute(
          'aria-pressed',
          btn.getAttribute('data-tool') === t ? 'true' : 'false'
        );
      });
    }

    function makeToolBtn(label, t) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'scratch-tool-btn';
      b.textContent = label;
      b.setAttribute('data-tool', t);
      b.setAttribute('aria-pressed', t === tool ? 'true' : 'false');
      b.addEventListener('click', () => setTool(t));
      return b;
    }

    toolbar.appendChild(makeToolBtn('Pen', 'pen'));
    toolbar.appendChild(makeToolBtn('Node', 'node'));
    toolbar.appendChild(makeToolBtn('Edge', 'edge'));

    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'scratch-tool-btn';
    undoBtn.textContent = 'Undo';
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
      }
      savePads() || showPersistFail();
      redraw();
    });
    toolbar.appendChild(undoBtn);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'scratch-tool-btn';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', () => {
      if (!confirm('Clear this scratchpad?')) return;
      data.strokes = [];
      data.nodes = [];
      data.edges = [];
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
    saveBtn.textContent = 'Save PNG';
    saveBtn.addEventListener('click', () => savePng(padKey));
    toolbar.appendChild(saveBtn);

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
      ctx2.font = '12px ' + getComputedStyle(document.documentElement).fontFamily;
      const tw = ctx2.measureText(label).width;
      const w = Math.max(tw + 16, 40);
      const h = 24;
      return { w, h };
    }

    function drawNode(ctx2, n, theme) {
      const p = px(n.x, n.y);
      const { w, h } = measureNode(ctx2, n.label || '');
      const x = p.x - w / 2;
      const y = p.y - h / 2;
      ctx2.fillStyle = theme.panel;
      ctx2.strokeStyle = theme.border;
      ctx2.lineWidth = 1;
      roundRect(ctx2, x, y, w, h, 6);
      ctx2.fill();
      ctx2.stroke();
      ctx2.fillStyle = theme.ink;
      ctx2.textAlign = 'center';
      ctx2.textBaseline = 'middle';
      ctx2.fillText(n.label || '', p.x, p.y);
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

    function drawEdge(ctx2, e, theme) {
      const from = data.nodes.find((n) => n.id === e.from);
      const to = data.nodes.find((n) => n.id === e.to);
      if (!from || !to) return;
      const a = px(from.x, from.y);
      const b = px(to.x, to.y);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const shrink = 14;
      const x1 = a.x + ux * shrink;
      const y1 = a.y + uy * shrink;
      const x2 = b.x - ux * shrink;
      const y2 = b.y - uy * shrink;

      ctx2.strokeStyle = theme.ink;
      ctx2.fillStyle = theme.ink;
      ctx2.lineWidth = 1.5;
      ctx2.beginPath();
      ctx2.moveTo(x1, y1);
      ctx2.lineTo(x2, y2);
      ctx2.stroke();

      const ah = 8;
      const ax = x2 - ux * ah + (-uy) * (ah * 0.45);
      const ay = y2 - uy * ah + ux * (ah * 0.45);
      const bx = x2 - ux * ah - (-uy) * (ah * 0.45);
      const by = y2 - uy * ah - ux * (ah * 0.45);
      ctx2.beginPath();
      ctx2.moveTo(x2, y2);
      ctx2.lineTo(ax, ay);
      ctx2.lineTo(bx, by);
      ctx2.closePath();
      ctx2.fill();

      if (e.label) {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const off = 12;
        const lx = mx + (-uy) * off;
        const ly = my + ux * off;
        ctx2.font =
          '11px ' + getComputedStyle(document.documentElement).fontFamily;
        ctx2.textAlign = 'center';
        ctx2.textBaseline = 'middle';
        ctx2.fillStyle = theme.ink;
        ctx2.fillText(e.label, lx, ly);
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
      for (const e of data.edges) drawEdge(ctx, e, theme);
      for (const n of data.nodes) drawNode(ctx, n, theme);
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

    function showInlineInput(clientX, clientY, initial, onCommit, onCancel) {
      removeInlineInput();
      const box = document.createElement('div');
      box.className = 'scratch-inline-input';
      const r = canvasWrap.getBoundingClientRect();
      box.style.left = clientX - r.left + 'px';
      box.style.top = clientY - r.top + 'px';
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = initial || '';
      inp.setAttribute('aria-label', 'Label');
      box.appendChild(inp);
      canvasWrap.appendChild(box);
      inlineInput = box;
      inp.focus();
      function commit() {
        const v = inp.value.trim();
        removeInlineInput();
        if (v) onCommit(v);
        else if (onCancel) onCancel();
      }
      inp.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          commit();
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          removeInlineInput();
          if (onCancel) onCancel();
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
        if (hit) {
          canvas.setPointerCapture(ev.pointerId);
          nodeDrag = { id: hit.id, startX: pt.x, startY: pt.y, moved: false };
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
      } else if (tool === 'node' && nodeDrag) {
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
      } else if (tool === 'edge' && edgeDrag) {
        edgeDrag.x = pt.x;
        edgeDrag.y = pt.y;
        redraw();
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
      } else if (tool === 'node' && nodeDrag) {
        if (nodeDrag.moved) persist();
        nodeDrag = null;
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
      edgeDrag = null;
      redraw();
    });

    const ro = new ResizeObserver(() => scheduleResize());
    ro.observe(canvasWrap);

    const themeObs = new MutationObserver(() => redraw());
    themeObs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    if (!scratchPersistOk) showPersistFail();

    resize();
    scheduleResize();

    return function destroy() {
      if (resizeRaf) {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = 0;
      }
      ro.disconnect();
      themeObs.disconnect();
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
      ctx.font = '12px ' + getComputedStyle(document.documentElement).fontFamily;
      const tw = ctx.measureText(n.label || '').width;
      const bw = Math.max(tw + 16, 40);
      const bh = 24;
      const x = p.x - bw / 2;
      const y = p.y - bh / 2;
      ctx.fillStyle = theme.panel;
      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1;
      roundRect(ctx, x, y, bw, bh, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = theme.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n.label || '', p.x, p.y);
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

    function drawEdge2(e) {
      const from = data.nodes.find((n) => n.id === e.from);
      const to = data.nodes.find((n) => n.id === e.to);
      if (!from || !to) return;
      const a = px2(from.x, from.y);
      const b = px2(to.x, to.y);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const shrink = 14;
      const x1 = a.x + ux * shrink;
      const y1 = a.y + uy * shrink;
      const x2 = b.x - ux * shrink;
      const y2 = b.y - uy * shrink;
      ctx.strokeStyle = theme.ink;
      ctx.fillStyle = theme.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      const ah = 8;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - ux * ah + (-uy) * (ah * 0.45), y2 - uy * ah + ux * (ah * 0.45));
      ctx.lineTo(x2 - ux * ah - (-uy) * (ah * 0.45), y2 - uy * ah - ux * (ah * 0.45));
      ctx.closePath();
      ctx.fill();
      if (e.label) {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const offN = 12;
        ctx.font = '11px ' + getComputedStyle(document.documentElement).fontFamily;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = theme.ink;
        ctx.fillText(e.label, mx + (-uy) * offN, my + ux * offN);
      }
    }

    for (const s of data.strokes) drawStroke2(s);
    for (const e of data.edges) drawEdge2(e);
    for (const n of data.nodes) drawNode2(n);

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
