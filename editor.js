"use strict";

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Editor = factory();
})(typeof self !== "undefined" ? self : this, function () {

  const PURPOSE = "kerbmusik-editor";
  const ROUNDS_MIN = 600000, ROUNDS_MAX = 10000000;
  const MAX_BYTES = 5 * 1024 * 1024;
  const ID = /^[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$/;
  const FORMAT = 2;
  const INBOX_DIR = "einsendungen", SUBMISSION_FILE = "einsendung.json", SCORE_FILE = "datei.mscz";

  const KINDS = {
    "new-melody": { button: "Neues Lied aus einer Melodie", what: "Neue Melodie", isNew: true, file: "Melodie",
      text: "Eine Melodie ist nur die Hauptstimme, mit Akkordsymbolen darüber. Die Partitur mit allen neun Stimmen, die Karten und die Aufnahme baut das Marschbuch daraus." },
    "new-score": { button: "Neues Lied als fertige Partitur", what: "Neue Partitur", isNew: true, file: "Partitur",
      text: "Eine fertige Partitur mit allen neun Stimmen des Marschbuchs, mit genau diesen Namen: 1. Stimme in C, 1. Stimme in B, 1. Stimme in Es, 1. Stimme in C Bass, 2. Stimme in C, 2. Stimme in B, 2. Stimme in Es, 2. Stimme in C Bass, 3. Stimme in C Bass. Am einfachsten die Partitur eines anderen Liedes als Vorlage nehmen." },
    "melody": { button: "Melodie hochladen", what: "Geänderte Melodie", isNew: false, file: "Melodie",
      text: "Die geänderte Melodie ersetzt die bisherige. Partitur, Karten und Aufnahme baut das Marschbuch daraus neu." },
    "score": { button: "Partitur hochladen", what: "Fertige Partitur", isNew: false, file: "Partitur",
      text: "Die Partitur wird genommen, wie sie ist, mit allen neun Stimmen. Hat das Lied eine Melodie, fällt sie weg: Änderungen gehen danach nur noch in der Partitur." },
  };

  const OLD_KINDS = { "melodie-neu": "new-melody", "partitur-neu": "new-score", "melodie": "melody", "partitur": "score" };
  const OLD_FIELDS = { "art": "kind", "titel": "title", "nummer": "number", "basis": "base", "partitur": "score", "melodie": "melody" };

  const STATUS = {
    pending: "Wird geprüft",
    accepted: "Übernommen, jetzt im Marschbuch",
    rejected: "Abgelehnt",
    error: "Problem bei der Prüfung",
  };
  const OLD_STATUS = { neu: "pending", uebernommen: "accepted", abgelehnt: "rejected", fehler: "error" };

  function fromB64u(s) {
    if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error("base64url");
    const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(b, c => c.charCodeAt(0));
  }

  function parseVault(text) {
    const parts = String(text || "").trim().split("~");
    if (parts.length < 4 || parts[0] !== "v1" || !/^[0-9]{1,9}$/.test(parts[2])) return null;
    try {
      const salt = fromB64u(parts[1]), rounds = parseInt(parts[2], 10);
      if (salt.length < 16 || rounds < ROUNDS_MIN || rounds > ROUNDS_MAX) return null;
      const entries = parts.slice(3).map(e => {
        const f = e.split(".");
        if (f.length !== 3 || !/^[A-Za-z0-9_-]{22}$/.test(f[0])) throw new Error("entry");
        const r = { id: f[0], iv: fromB64u(f[1]), data: fromB64u(f[2]) };
        if (r.iv.length !== 12 || r.data.length < 17) throw new Error("entry");
        return r;
      });
      return { saltText: parts[1], salt, rounds, entries };
    } catch { return null; }
  }

  const vaultAad = (vault, entry) => `${PURPOSE}|v1|${vault.rounds}|${vault.saltText}|${entry.id}`;

  function vaultContent(content) {
    if (!content || content.format !== 1 || content.purpose !== PURPOSE || typeof content.person !== "string"
      || !content.config || typeof content.config !== "object" || !/^[0-9a-f]{64}$/.test(content.config.filesKey || "")) return null;
    return content;
  }

  function normalTitle(text) {
    return String(text || "").normalize("NFC").trim().replace(/\s+/g, " ");
  }

  const foldTitle = text => String(text).normalize("NFC").toUpperCase().toLowerCase();
  const RESERVED = ["books", "edit"];

  function slug(text) {
    const t = String(text).normalize("NFC").toLowerCase()
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .normalize("NFKD").replace(/[^\x00-\x7f]/g, "");
    return t.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
  }

  function titleProblem(title, names = []) {
    if (!title) return "Bitte einen Titel eingeben.";
    if (title !== normalTitle(title)) return "Der Titel hat Leerzeichen am Rand oder doppelt.";
    if ([...title].length > 80) return "Der Titel ist zu lang (höchstens 80 Zeichen).";
    if (title.startsWith(".")) return "Der Titel darf nicht mit einem Punkt anfangen.";
    if (!/^[\p{L}\p{N} .,'!?()&-]+$/u.test(title)) return "Im Titel gehen nur Buchstaben, Ziffern, Leerzeichen und . , ' ! ? ( ) - &";
    if (!/[\p{L}\p{N}]/u.test(title)) return "Der Titel braucht mindestens einen Buchstaben oder eine Ziffer.";
    if (RESERVED.includes(slug(title))) return `Den Titel „${title}“ braucht das Marschbuch selbst. Bitte einen anderen wählen.`;
    const folded = foldTitle(title);
    const same = names.find(n => foldTitle(n) === folded);
    if (same) return `Das Lied „${same}“ gibt es schon.`;
    const near = names.find(n => slug(n) === slug(title));
    if (near) return `Der Titel ist zu ähnlich wie „${near}“, beide hätten im Marschbuch dieselbe Adresse. Bitte einen anderen Titel wählen.`;
    return null;
  }

  function wholeNumber(text, low, high, what) {
    const t = String(text ?? "").trim();
    if (!t) return { value: null };
    if (!/^[0-9]{1,4}$/.test(t) || +t < low || +t > high) return { problem: `${what} muss eine ganze Zahl von ${low} bis ${high} sein.` };
    return { value: +t };
  }

  function newId(date = new Date(), random = Math.random) {
    const d = date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    let r = "";
    for (let i = 0; i < 6; i++) r += Math.floor(random() * 16).toString(16);
    return `${d}-${r}`;
  }

  function fileProblem(bytes, size = bytes?.length) {
    if (!size) return "Bitte eine Datei wählen.";
    if (size > MAX_BYTES) return "Die Datei ist zu groß (höchstens 5 MB).";
    if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04))
      return "Das ist keine MuseScore-Datei (.mscz).";
    return null;
  }

  function submission({ id, kind, piece, title, tempo, person, created = new Date() }) {
    const s = { format: FORMAT, id, kind, person, created: created.toISOString() };
    if (KINDS[kind].isNew) {
      s.title = title;
      if (tempo != null) s.tempo = tempo;
    } else {
      s.title = piece.name;
      s.base = piece.base || null;
    }
    return s;
  }

  function renameOldFields(old) {
    const out = {};
    for (const [key, value] of Object.entries(old)) out[OLD_FIELDS[key] || key] = value;
    if ("kind" in out) out.kind = OLD_KINDS[out.kind] || out.kind;
    return out;
  }

  function readSubmission(s) {
    if (!s || typeof s !== "object") return {};
    return s.format === 1 ? renameOldFields(s) : s;
  }

  function catalogPiece(p) {
    if (!p || !("art" in p)) return p;
    const out = renameOldFields(p);
    return { ...out, base: out.base ?? null, melody: out.melody ?? null };
  }

  function commitMessage(s) {
    return `${KINDS[s.kind].what}: ${s.title} von ${s.person}`.replace(/[\r\n]+/g, " ").slice(0, 200);
  }

  function kindsFor(piece) {
    return piece?.kind === "melody" ? ["melody", "score"] : ["score"];
  }

  function submittedFolders(tree, limit = 20) {
    const folders = new Map();
    const pattern = new RegExp(`^${INBOX_DIR}/([0-9]{8}-[0-9]{6}-[0-9a-f]{6})/([^/]+)$`);
    for (const e of tree || []) {
      const m = pattern.exec(e.path);
      if (!m || e.type !== "blob") continue;
      if (!folders.has(m[1])) folders.set(m[1], { id: m[1], files: [] });
      folders.get(m[1]).files.push({ name: m[2], path: e.path, sha: e.sha });
    }
    return [...folders.values()].sort((a, b) => b.id.localeCompare(a.id)).slice(0, limit);
  }

  function statusOf(status) {
    const value = OLD_STATUS[status?.status] || status?.status;
    return STATUS[value] ? value : "pending";
  }

  function describe(raw, status, now = Date.now()) {
    const s = readSubmission(raw);
    const st = statusOf(status);
    const late = st === "pending" && now - Date.parse(s.created || "") > 30 * 60 * 1000;
    return {
      title: `${KINDS[s.kind]?.what || "Einsendung"}: ${s.title || "?"}`,
      who: `${s.person || ""}${s.created ? `, ${new Date(s.created).toLocaleString("de-AT", { dateStyle: "short", timeStyle: "short" })}` : ""}`,
      status: st,
      text: STATUS[st],
      note: typeof status?.text === "string" ? status.text.slice(0, 500) : late ? "Das dauert ungewöhnlich lange. Bitte Paul Bescheid geben." : "",
    };
  }

  return { PURPOSE, RESERVED, slug, ROUNDS_MIN, ROUNDS_MAX, MAX_BYTES, ID, FORMAT, INBOX_DIR, SUBMISSION_FILE, SCORE_FILE, KINDS, STATUS,
           parseVault, vaultAad, vaultContent, normalTitle, titleProblem, wholeNumber, newId, fileProblem,
           submission, readSubmission, catalogPiece, commitMessage, kindsFor, submittedFolders, statusOf, describe };
});
