"use strict";

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MusicStand = factory();
})(typeof self !== "undefined" ? self : this, function () {

  const COLOURS = [
    [/fl[öo]te/i, "#9b2d4b"],
    [/trompete|fl[üu]gelhorn/i, "#1f5fae"],
    [/klarinette/i, "#6b4fa0"],
    [/bariton in b|tenorhorn|euphonium/i, "#85592f"],
    [/tuba|rhythmus|bass/i, "#4f5d6b"],
    [/posaune|bariton/i, "#4a7a64"],
  ];
  const DEFAULT_COLOUR = "#4a7a64";

  const NOTATION_COLOURS = { "C": "#9b2d4b", "B": "#1f5fae", "C Bass": "#4a7a64", "Es": "#85592f", "B tief": "#85592f" };

  function colour(name) {
    const parsed = parsePart(name);
    if (parsed && NOTATION_COLOURS[parsed.notation]) return NOTATION_COLOURS[parsed.notation];
    const match = COLOURS.find(([pattern]) => pattern.test(name || ""));
    return match ? match[1] : DEFAULT_COLOUR;
  }

  const VOICES = [
    { voice: "1. Stimme", text: "Melodie" },
    { voice: "2. Stimme", text: "Unter der Melodie" },
    { voice: "3. Stimme", text: "Bass und Nachschlag" },
  ];
  const NOTATIONS = [
    { notation: "C", text: "in C, Violinschlüssel" },
    { notation: "B", text: "in B, Violinschlüssel" },
    { notation: "C Bass", text: "in C, Bassschlüssel" },
    { notation: "Es", text: "in Es, Violinschlüssel" },
  ];
  const OLD_NAMES = {
    "Flöte": ["1. Stimme", "C"],
    "Trompete in B": ["1. Stimme", "B"],
    "Posaune/Bariton Melodie": ["1. Stimme", "C Bass"],
    "Klarinette in B": ["2. Stimme", "B"],
    "Bariton in B": ["2. Stimme", "B tief"],
    "Posaune/Bariton": ["2. Stimme", "C Bass"],
    "Rhythmus": ["3. Stimme", "C Bass"],
  };
  const OTHERS = "Weitere";

  function parsePart(name) {
    const match = /^\s*(\d+)\.\s*Stimme\s+in\s+(C|B|Es|F)(\s*\(?\s*Bass(?:schlüssel)?\s*\)?)?\s*$/i.exec(name || "");
    if (match) {
      const key = { c: "C", b: "B", es: "Es", f: "F" }[match[2].toLowerCase()];
      return { voice: `${match[1]}. Stimme`, notation: match[3] ? `${key} Bass` : key };
    }
    const old = OLD_NAMES[name];
    return old ? { voice: old[0], notation: old[1] } : null;
  }

  function notationText(notation) {
    return NOTATIONS.find(n => n.notation === notation)?.text
      ?? (notation === "B tief" ? "in B, Violinschlüssel tief" : `in ${notation.replace(" Bass", ", Bassschlüssel")}`);
  }

  function grouping(parts) {
    const groups = new Map(VOICES.map(v => [v.voice, { ...v, clefs: [] }]));
    const others = { voice: OTHERS, text: "", clefs: [] };
    for (const { id, name } of parts || []) {
      const parsed = parsePart(name);
      if (!parsed) { others.clefs.push({ id, name, clef: name, notation: null }); continue; }
      if (!groups.has(parsed.voice)) groups.set(parsed.voice, { voice: parsed.voice, text: "", clefs: [] });
      groups.get(parsed.voice).clefs.push({ id, name, clef: notationText(parsed.notation), notation: parsed.notation });
    }
    const rank = n => { const i = NOTATIONS.findIndex(x => x.notation === n); return i < 0 ? NOTATIONS.length : i; };
    const list = [...groups.values()].sort((a, b) => parseInt(a.voice) - parseInt(b.voice));
    for (const g of list) g.clefs.sort((a, b) => rank(a.notation) - rank(b.notation));
    return [...list, others].filter(g => g.clefs.length);
  }

  function label(parts, id) {
    const name = (parts || []).find(p => p.id === id)?.name;
    if (!name) return "";
    const parsed = parsePart(name);
    if (!parsed) return name;
    const group = grouping(parts).find(g => g.clefs.some(c => c.id === id));
    if (group.clefs.length === 1) return parsed.voice;
    const short = { "C Bass": "in C (Bass)", "B tief": "in B (tief)" }[parsed.notation] ?? `in ${parsed.notation}`;
    return `${parsed.voice} ${short}`;
  }

  const NARROW_BELOW = 600;
  function format(choice, width) {
    if (choice === "wide" || choice === "narrow") return choice;
    return width < NARROW_BELOW ? "narrow" : "wide";
  }

  function partOf(piece, partId) {
    return Object.values(piece?.parts || {}).find(p => p.id === partId) || null;
  }

  function pages(piece, partId, fmt) {
    const part = partOf(piece, partId);
    if (!part) return null;
    return part[fmt]?.length ? part[fmt] : part.wide || part.narrow || null;
  }

  function timingFile(piece, partId, fmt) {
    const part = partOf(piece, partId);
    if (!part) return null;
    const used = part[fmt]?.length ? fmt : part.wide ? "wide" : "narrow";
    return part.timing?.[used] || null;
  }

  function preload(catalog, partId, fmt, from = 0) {
    const list = catalog?.pieces || [];
    const order = list.slice(from).concat(list.slice(0, from));
    return order.flatMap(p => (pages(p, partId, fmt) || []).map(page => page.file));
  }

  function neighbour(count, index, step) {
    if (!count) return 0;
    return Math.max(0, Math.min(count - 1, index + step));
  }

  function swipe(dx, dy, ms) {
    if (ms > 800 || Math.abs(dx) < 60 || Math.abs(dx) < 1.5 * Math.abs(dy)) return 0;
    return dx < 0 ? 1 : -1;
  }

  function key(name, { top = true, bottom = true } = {}) {
    switch (name) {
      case "ArrowRight": return 1;
      case "ArrowLeft": return -1;
      case "PageDown": case "ArrowDown": case " ": return bottom ? 1 : "down";
      case "PageUp": case "ArrowUp": return top ? -1 : "up";
      default: return null;
    }
  }

  function start(catalog, address, remembered = {}) {
    const parts = (catalog?.parts || []).map(p => p.id);
    const pieces = (catalog?.pieces || []).map(p => p.id);
    let decoded = "";
    try { decoded = decodeURIComponent((address || "").replace(/^#/, "")); } catch {}
    const [aPart, aPiece] = decoded.split("/");
    const part = [aPart, remembered.part].find(p => parts.includes(p)) || null;
    const piece = [aPiece, remembered.piece].find(p => pieces.includes(p));
    return { part, index: Math.max(0, pieces.indexOf(piece)) };
  }


  const SIZES = [30, 40, 50, 60, 70, 80, 90, 100];

  function zoom(size, direction) {
    if (direction > 0) return SIZES.find(s => s > size + 0.5) ?? SIZES[SIZES.length - 1];
    return [...SIZES].reverse().find(s => s < size - 0.5) ?? SIZES[0];
  }

  function fitSize(sizes, width, height) {
    const sum = sizes.reduce((total, [w, h]) => total + h / w, 0);
    if (!sum || !width) return 100;
    return Math.max(SIZES[0], Math.min(100, Math.floor(height / sum / width * 100)));
  }


  const SPACINGS = [3, 4, 5, 6, 7, 8, 9, 10, 12, 14];
  const SPACING = { wide: 8, narrow: 3 };

  function spacingOf(spacing, fmt) {
    const value = Number(spacing?.[fmt]);
    return SPACINGS.includes(value) ? value : SPACING[fmt] ?? SPACING.wide;
  }

  function spacingStep(spacing, direction, fallback = SPACING.wide) {
    const i = SPACINGS.indexOf(Number(spacing));
    const at = i >= 0 ? i : SPACINGS.indexOf(fallback);
    return SPACINGS[Math.max(0, Math.min(SPACINGS.length - 1, at + direction))];
  }

  function systemShifts(bands, gap) {
    const shifts = [];
    bands.forEach(([top], i) => {
      shifts.push(i ? shifts[i - 1] + Math.max(0, gap - (top - bands[i - 1][1])) : 0);
    });
    return shifts;
  }

  function nearestBand(bands, y) {
    let best = 0, distance = Infinity;
    bands.forEach(([top, bottom], i) => {
      const d = y < top ? top - y : y > bottom ? y - bottom : 0;
      if (d < distance) { distance = d; best = i; }
    });
    return best;
  }

  function shownY(bands, shifts, y) {
    return bands.length ? y + shifts[nearestBand(bands, y)] : y;
  }

  function renderedY(bands, shifts, y) {
    if (!bands.length) return y;
    const moved = bands.map(([top, bottom], i) => [top + shifts[i], bottom + shifts[i]]);
    return y - shifts[nearestBand(moved, y)];
  }


  function eventAt(events, ms) {
    let low = 0, high = events.length - 1, found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (events[mid][0] <= ms) { found = mid; low = mid + 1; } else high = mid - 1;
    }
    return found;
  }

  function segmentOfNote(segments, page, x, y) {
    let best = null, distance = Infinity;
    segments.forEach(([p, sx, sy, w, h], i) => {
      if (p !== page || x < sx - 4 || x >= sx + Math.max(w, 20)) return;
      const d = Math.abs(y - (sy + h / 2));
      if (d < distance) { distance = d; best = i; }
    });
    return best;
  }

  function segmentAtPoint(segments, page, x, y) {
    const onPage = segments.map((s, i) => [s, i]).filter(([s]) => s[0] === page);
    if (!onPage.length) return null;
    const line = s => Math.abs(y - (s[2] + s[4] / 2));
    const nearest = Math.min(...onPage.map(([s]) => line(s)));
    let best = null, distance = Infinity;
    for (const [s, i] of onPage) {
      if (line(s) - nearest > 1) continue;
      const d = x < s[1] ? s[1] - x : x > s[1] + s[3] ? x - s[1] - s[3] : 0;
      if (d < distance) { distance = d; best = i; }
    }
    return best;
  }

  function timeOf(events, segment, now = 0) {
    let best = null;
    for (const [ms, s] of events)
      if (s === segment && (best === null || Math.abs(ms - now) < Math.abs(best - now))) best = ms;
    return best;
  }

  function clock(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }


  function keyFromAddress(address) {
    const match = /(?:^#|[#&])k=([0-9a-fA-F]{64}|[A-Za-z0-9_-]{43})(?:&|$)/.exec(address || "");
    return match ? match[1] : null;
  }

  function normalPassword(text) {
    return (text || "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
  }

  return { normalPassword, COLOURS, colour, VOICES, NOTATIONS, parsePart, grouping, label, NARROW_BELOW, format, pages, timingFile, preload,
           neighbour, swipe, key, start, SIZES, zoom, fitSize, SPACINGS, SPACING, spacingOf, spacingStep, systemShifts, shownY, renderedY, eventAt, segmentOfNote, segmentAtPoint, timeOf, clock,
           keyFromAddress };
});
