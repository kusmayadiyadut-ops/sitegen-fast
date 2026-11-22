// Fast drop-in for makefun-site 1.0.0 (site-generator-speed-01-run-20261122).
// Written from the reference's README + behaviour: same answers, byte for byte,
// produced with a single-pass Markdown renderer, bulk HTML escaping and cached
// slugs instead of the reference's per-character work. Dependency-free ES module.
// run(input) returns the output tree { path: text } for one case's input.

'use strict';

// ---------------------------------------------------------------- front matter
// makefun-site's front matter: a strict subset of YAML block mappings (see the
// reference's lib/frontmatter.js). Copied semantics, line by line.

const FM_KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];

// Manual parse of a "key: value" line (was /^([a-z_]+):(?: (.*))?$/): the key is
// [a-z_]+, then ':' and either the end or one space and the value.
function fmLineOf(line) {
  let i = 0;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if ((c >= 97 && c <= 122) || c === 95) i++;
    else break;
  }
  if (i === 0 || i >= line.length || line.charCodeAt(i) !== 58) return null; // ':'
  if (i + 1 === line.length) return { key: line.slice(0, i), raw: '' };
  if (line.charCodeAt(i + 1) !== 32) return null;
  return { key: line.slice(0, i), raw: line.slice(i + 2) };
}

// Manual YYYY-MM-DD check (was /^(\d{4})-(\d{2})-(\d{2})$/).
function fmDateParts(raw) {
  if (raw.length !== 10 || raw.charCodeAt(4) !== 45 || raw.charCodeAt(7) !== 45) return null;
  for (let i = 0; i < 10; i++) {
    if (i === 4 || i === 7) continue;
    const c = raw.charCodeAt(i);
    if (c < 48 || c > 57) return null;
  }
  return [
    (raw.charCodeAt(0) - 48) * 1000 + (raw.charCodeAt(1) - 48) * 100 + (raw.charCodeAt(2) - 48) * 10 + (raw.charCodeAt(3) - 48),
    (raw.charCodeAt(5) - 48) * 10 + (raw.charCodeAt(6) - 48),
    (raw.charCodeAt(8) - 48) * 10 + (raw.charCodeAt(9) - 48),
  ];
}

function fmDaysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

const FM_NAME = /^[a-z0-9-]+$/;
const FM_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function fmStringOf(raw) {
  if (raw.charCodeAt(0) === 34) { // '"'
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' }; // '['
  return { value: raw };
}

function fmValueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = fmStringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const p = fmDateParts(raw);
      const y = p ? p[0] : 0;
      const mo = p ? p[1] : 0;
      const d = p ? p[2] : 0;
      if (!p || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > fmDaysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      for (let k = 0; k < tags.length; k++) {
        const t = tags[k];
        if (t === '' || t.indexOf('"') !== -1 || t.indexOf('[') !== -1 || t.indexOf(']') !== -1) {
          return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
        }
      }
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return FM_NAME.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return FM_SLUG.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

function parseFrontMatter(text) {
  // The first line must be exactly '---', and the front matter runs to the next
  // line that is exactly '---'. Only those lines are split out; the body is
  // sliced, never split and re-joined.
  const firstNl = text.indexOf('\n');
  const firstLine = firstNl === -1 ? text : text.slice(0, firstNl);
  if (firstLine !== '---') return { error: 'no front matter' };
  if (firstNl === -1) return { error: 'the front matter is not closed' };
  let closeStart = -1;
  let closeEnd = -1;
  let pos = firstNl + 1;
  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? text.length : nl;
    if (lineEnd - pos === 3 && text.charCodeAt(pos) === 45 && text.charCodeAt(pos + 1) === 45 && text.charCodeAt(pos + 2) === 45) {
      closeStart = pos;
      closeEnd = lineEnd;
      break;
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  if (closeStart === -1) return { error: 'the front matter is not closed' };
  const fmText = text.slice(firstNl + 1, closeStart - 1);
  const lines = fmText === '' ? [] : fmText.split('\n');
  const data = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isBlank(line) || line.charCodeAt(0) === 35) continue; // blank or '#'
    const m = fmLineOf(line);
    if (m === null) return { error: `line ${i + 2} is not "key: value"` };
    const key = m.key;
    let raw = m.raw;
    let e = raw.length;
    while (e > 0 && (raw.charCodeAt(e - 1) === 32 || raw.charCodeAt(e - 1) === 9)) e--;
    if (e !== raw.length) raw = raw.slice(0, e);
    if (FM_KEYS.indexOf(key) === -1) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = fmValueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  const body = closeEnd === text.length ? '' : text.slice(closeEnd + 1);
  return { data, body };
}

// ---------------------------------------------------------------- text
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Manual escape: returns the input untouched when it holds no special character
// (the common case for titles, URLs and code), so no string is built then.
function escapeHtml(text) {
  const n = text.length;
  let out = null;
  let start = 0;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    let rep = null;
    if (c === 38) rep = '&amp;';
    else if (c === 60) rep = '&lt;';
    else if (c === 62) rep = '&gt;';
    else if (c === 34) rep = '&quot;';
    else if (c === 39) rep = '&#39;';
    if (rep !== null) {
      if (out === null) out = text.slice(0, i);
      else out += text.slice(start, i);
      out += rep;
      start = i + 1;
    }
  }
  if (out === null) return text;
  return out + text.slice(start);
}

// Slug cache: titles and tag names repeat across a site's sources.
const slugCache = new Map();
const NON_ASCII = /[^\x00-\x7F]/;

function slugify(text) {
  const hit = slugCache.get(text);
  if (hit !== undefined) return hit;
  let out;
  if (!NON_ASCII.test(text)) {
    // Pure ASCII: NFKD is the identity and there are no combining marks.
    out = '';
    let gap = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      let keep = null;
      if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
      else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
      if (keep === null) {
        gap = out.length > 0;
        continue;
      }
      if (gap) out += '-';
      gap = false;
      out += keep;
    }
  } else {
    const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
    out = '';
    let gap = false;
    for (const ch of plain) {
      let keep = null;
      if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
      else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
      if (keep === null) {
        gap = out.length > 0;
        continue;
      }
      if (gap) out += '-';
      gap = false;
      out += keep;
    }
  }
  out = out.slice(0, 64).replace(/-+$/, '');
  if (out === '') out = 'untitled';
  slugCache.set(text, out);
  return out;
}

function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function longDate(date) {
  const y = date.slice(0, 4);
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// ---------------------------------------------------------------- markdown
// Single-pass block scan + bulk-escape inline renderer. Same output as the
// reference's lex-then-render, without its per-character escapeHtml calls.

// A line of only spaces/tabs (or empty).
function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

// Trim spaces/tabs at both ends (trimLine in the reference).
function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  return a === 0 && b === line.length ? line : line.slice(a, b);
}

// Fence open: ``` + lang ([A-Za-z0-9_+-]*) + spaces/tabs only; returns lang or null.
function fenceLang(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return null;
  let i = 3;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45;
    if (!ok) break;
    i++;
  }
  const lang = line.slice(3, i);
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return null;
    i++;
  }
  return lang;
}

function isFenceClose(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return false;
  for (let i = 3; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

// Heading: 1-6 '#', >=1 space/tab, non-empty text (trailing spaces/tabs dropped).
function headingOf(line) {
  let n = 0;
  while (n < line.length && line.charCodeAt(n) === 35) n++;
  if (n === 0 || n > 6) return null;
  if (n >= line.length) return null;
  const c = line.charCodeAt(n);
  if (c !== 32 && c !== 9) return null;
  let j = n;
  while (j < line.length && (line.charCodeAt(j) === 32 || line.charCodeAt(j) === 9)) j++;
  let e = line.length;
  while (e > j && (line.charCodeAt(e - 1) === 32 || line.charCodeAt(e - 1) === 9)) e--;
  if (e === j) return null;
  return { depth: n, text: line.slice(j, e) };
}

// Thematic break: --- or *** then spaces/tabs only.
function isHr(line) {
  const c = line.charCodeAt(0);
  if (c !== 45 && c !== 42) return false; // '-' or '*'
  if (line.charCodeAt(1) !== c || line.charCodeAt(2) !== c) return false;
  for (let i = 3; i < line.length; i++) {
    const d = line.charCodeAt(i);
    if (d !== 32 && d !== 9) return false;
  }
  return true;
}

// Whether a line ends a paragraph: blank, fence open, heading or thematic break.
function endsParagraph(line) {
  return isBlank(line) || fenceLang(line) !== null || headingOf(line) !== null || isHr(line);
}

// Bullet: '- ' or '* ' with text after; ordered: 1-9 digits + '. ' with text after.
function listMarker(line) {
  const c0 = line.charCodeAt(0);
  if ((c0 === 45 || c0 === 42) && line.charCodeAt(1) === 32) return { ordered: false, start: 1, text: line.slice(2) };
  if (c0 >= 48 && c0 <= 57) {
    let i = 0;
    let num = 0;
    while (i < 9 && i < line.length && line.charCodeAt(i) >= 48 && line.charCodeAt(i) <= 57) {
      num = num * 10 + (line.charCodeAt(i) - 48);
      i++;
    }
    if (i > 0 && line.charCodeAt(i) === 46 && line.charCodeAt(i + 1) === 32) {
      return { ordered: true, start: num, text: line.slice(i + 2) };
    }
  }
  return null;
}

// List continuation: >=2 spaces then a non-whitespace character.
function isContinued(line) {
  let i = 0;
  while (i < line.length && line.charCodeAt(i) === 32) i++;
  if (i < 2 || i >= line.length) return false;
  return !/\s/.test(line[i]);
}

// The characters a backslash escapes.
function isEscapable(code) {
  return code === 92 || code === 96 || code === 42 || code === 95 || code === 91 || code === 93 ||
    code === 40 || code === 41 || code === 35 || code === 43 || code === 45 || code === 46 ||
    code === 33 || code === 62;
}

// Whether position `j` is escaped: replay the backslash scan from `from`, unless
// no backslash sits between them at all (the common case — one native search).
function isEscapedAt(s, from, j) {
  const bs = s.indexOf('\\', from);
  if (bs === -1 || bs >= j) return false;
  let k = from;
  while (k < j) {
    if (s.charCodeAt(k) === 92 && k + 1 < s.length && isEscapable(s.charCodeAt(k + 1))) k += 2;
    else k++;
  }
  return k > j;
}

// The first index from `from` where `s` holds `what` outside a backslash escape, or -1.
function findUnescaped(s, what, from) {
  let j = s.indexOf(what, from);
  while (j !== -1) {
    if (!isEscapedAt(s, from, j)) return j;
    j = s.indexOf(what, j + 1);
  }
  return -1;
}

// The first single * from `from` (one whose run is not **), outside an escape, or -1.
function findSingleStar(s, from) {
  let j = s.indexOf('*', from);
  while (j !== -1) {
    if (!isEscapedAt(s, from, j)) {
      if (s.charCodeAt(j + 1) === 42) {
        from = j + 2;
        j = s.indexOf('*', from);
        continue;
      }
      return j;
    }
    j = s.indexOf('*', j + 1);
  }
  return -1;
}

const WS_RE = /\s/;

const INLINE_SPECIAL = /[\\`*\[&<>"']/;

// `s` rendered inline; `env.link(target)` is a link's href.
// One pass: plain runs are pushed raw (the loop itself stops at every character
// that needs escaping or markup, so a plain run never holds one), which drops the
// reference's per-character escapeHtml calls entirely. Text holding none of the
// markup or escape characters is returned as it is.
function inline(s, env) {
  if (!INLINE_SPECIAL.test(s)) return s;
  const parts = [];
  const n = s.length;
  let i = 0;
  let plain = 0; // start of the current plain run
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 92 && i + 1 < n && isEscapable(s.charCodeAt(i + 1))) { // backslash escape
      if (i > plain) parts.push(s.slice(plain, i));
      // '>' is the only escapable character that is also HTML-special.
      parts.push(s[i + 1] === '>' ? '&gt;' : s[i + 1]);
      i += 2;
      plain = i;
      continue;
    }
    if (c === 38 || c === 60 || c === 62 || c === 34 || c === 39) { // & < > " '
      if (i > plain) parts.push(s.slice(plain, i));
      parts.push(c === 38 ? '&amp;' : c === 60 ? '&lt;' : c === 62 ? '&gt;' : c === 34 ? '&quot;' : '&#39;');
      i++;
      plain = i;
      continue;
    }
    if (c === 96) { // code span
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        if (i > plain) parts.push(s.slice(plain, i));
        parts.push('<code>', escapeHtml(s.slice(i + 1, j)), '</code>');
        i = j + 1;
        plain = i;
      } else {
        i++;
      }
      continue;
    }
    if (c === 42) { // strong / emphasis
      if (s.charCodeAt(i + 1) === 42) {
        const j = findUnescaped(s, '**', i + 2);
        if (j > i + 2) {
          if (i > plain) parts.push(s.slice(plain, i));
          parts.push('<strong>', inline(s.slice(i + 2, j), env), '</strong>');
          i = j + 2;
          plain = i;
        } else {
          i += 2;
        }
        continue;
      }
      const j = findSingleStar(s, i + 1);
      if (j > i + 1) {
        if (i > plain) parts.push(s.slice(plain, i));
        parts.push('<em>', inline(s.slice(i + 1, j), env), '</em>');
        i = j + 1;
        plain = i;
      } else {
        i++;
      }
      continue;
    }
    if (c === 91) { // link
      const k = findUnescaped(s, ']', i + 1);
      const m = k !== -1 && s.charCodeAt(k + 1) === 40 ? s.indexOf(')', k + 2) : -1;
      const target = m === -1 ? '' : s.slice(k + 2, m);
      if (target !== '' && !WS_RE.test(target)) {
        if (i > plain) parts.push(s.slice(plain, i));
        parts.push('<a href="', escapeHtml(env.link(target)), '">', inline(s.slice(i + 1, k), env), '</a>');
        i = m + 1;
        plain = i;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }
  if (n > plain) parts.push(s.slice(plain, n));
  return parts.join('');
}

// `src` rendered: HTML, table of contents and excerpt — same shape as the reference.
// The block loop dispatches on the line's first character: only a line that can
// open a fence, heading, break, quote or list pays for that test, and a paragraph
// line is never re-examined for them.
function renderMarkdown(src, env) {
  const lines = src.split('\n');
  const n = lines.length;
  const ids = new Set();
  const blocks = [];
  const toc = [];
  let excerpt = null;
  let i = 0;
  while (i < n) {
    const line = lines[i];
    const c0 = line.length === 0 ? -1 : line.charCodeAt(0);
    if (c0 === -1 || c0 === 32 || c0 === 9) {
      if (isBlank(line)) { i++; continue; }
      // A non-blank line opening on a space or tab is paragraph text.
    } else if (c0 === 96) { // '`' — a fence, or paragraph text
      const lang = fenceLang(line);
      if (lang !== null) {
        const body = [];
        i++;
        while (i < n && !isFenceClose(lines[i])) body.push(lines[i++]);
        i++;
        const cls = lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`;
        const code = body.length === 0 ? '' : escapeHtml(body.join('\n')) + '\n';
        blocks.push(`<pre><code${cls}>${code}</code></pre>\n`);
        continue;
      }
    } else if (c0 === 35) { // '#' — a heading, or paragraph text
      const heading = headingOf(line);
      if (heading !== null) {
        const id = uniqueSlug(slugify(heading.text), ids);
        const html = inline(heading.text, env);
        blocks.push(`<h${heading.depth} id="${id}">${html}</h${heading.depth}>\n`);
        if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html });
        i++;
        continue;
      }
    } else if (c0 === 45 || c0 === 42) { // '-' or '*' — a break, a list, or paragraph text
      if (isHr(line)) {
        blocks.push('<hr>\n');
        i++;
        continue;
      }
      const marker = listMarker(line);
      if (marker !== null) {
        const isOrdered = marker.ordered;
        const items = [];
        while (i < n) {
          const m = listMarker(lines[i]);
          if (m !== null && m.ordered === isOrdered) {
            items.push([trimLine(m.text)]);
            i++;
          } else if (items.length > 0 && isContinued(lines[i])) {
            items[items.length - 1].push(trimLine(lines[i]));
            i++;
          } else break;
        }
        const tag = isOrdered ? 'ol' : 'ul';
        const open = isOrdered && marker.start !== 1 ? `<ol start="${marker.start}">` : `<${tag}>`;
        let out = `${open}\n`;
        for (let k = 0; k < items.length; k++) out += `<li>${inline(items[k].join('\n'), env)}</li>\n`;
        blocks.push(`${out}</${tag}>\n`);
        continue;
      }
    } else if (c0 === 62) { // '>' — a blockquote
      const body = [];
      while (i < n && lines[i].charCodeAt(0) === 62) {
        const l = lines[i++];
        body.push(l.charCodeAt(1) === 32 ? l.slice(2) : l.slice(1));
      }
      const kept = [];
      for (let k = 0; k < body.length; k++) {
        const t = trimLine(body[k]);
        if (t !== '') kept.push(t);
      }
      blocks.push(kept.length === 0 ? '<blockquote>\n</blockquote>\n' : `<blockquote>\n<p>${inline(kept.join('\n'), env)}</p>\n</blockquote>\n`);
      continue;
    } else if (c0 >= 48 && c0 <= 57) { // a digit — an ordered list, or paragraph text
      const marker = listMarker(line);
      if (marker !== null) {
        const items = [];
        while (i < n) {
          const m = listMarker(lines[i]);
          if (m !== null && m.ordered) {
            items.push([trimLine(m.text)]);
            i++;
          } else if (items.length > 0 && isContinued(lines[i])) {
            items[items.length - 1].push(trimLine(lines[i]));
            i++;
          } else break;
        }
        const open = marker.start !== 1 ? `<ol start="${marker.start}">` : '<ol>';
        let out = `${open}\n`;
        for (let k = 0; k < items.length; k++) out += `<li>${inline(items[k].join('\n'), env)}</li>\n`;
        blocks.push(`${out}</ol>\n`);
        continue;
      }
    }
    // A paragraph: this line and the lines after it up to a blank line, a fence,
    // a heading or a thematic break.
    const body = [trimLine(line)];
    i++;
    while (i < n) {
      const l = lines[i];
      const d0 = l.length === 0 ? -1 : l.charCodeAt(0);
      if (d0 === -1 || d0 === 32 || d0 === 9) {
        if (isBlank(l)) break;
      } else if (d0 === 96) {
        if (fenceLang(l) !== null) break;
      } else if (d0 === 35) {
        if (headingOf(l) !== null) break;
      } else if (d0 === 45 || d0 === 42) {
        if (isHr(l)) break;
      }
      body.push(trimLine(l));
      i++;
    }
    const html = inline(body.join('\n'), env);
    if (excerpt === null) excerpt = html;
    blocks.push(`<p>${html}</p>\n`);
  }
  return { html: blocks.join(''), toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- templates
// The reference's dialect (lib/template.js): {{ }}, {{{ }}}, {% for %},
// {% if %}, {% include %}. Parser copied; renderer pushes into one array.

class TemplateError extends Error {}
const INCLUDE_DEPTH = 8;
const TPL_PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const TPL_FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const TPL_IF = /^if (not )?(\S+)$/;
const TPL_INCLUDE = /^include "([a-z0-9-]+)"$/;

function tplPathOf(name, text) {
  if (!TPL_PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: tplPathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = TPL_FOR.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: tplPathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = TPL_IF.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: tplPathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = TPL_INCLUDE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

// Parsed templates repeat across a run's cases; the parse is pure, so cache it.
const templateCache = new Map();
function parseTemplateCached(name, src) {
  const key = `${name}\u0000${src}`;
  const hit = templateCache.get(key);
  if (hit !== undefined) return hit;
  const nodes = parseTemplate(name, src);
  templateCache.set(key, nodes);
  return nodes;
}

function lookup(scope, path) {
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, path[0])) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[path[0]];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

function renderNodes(nodes, scope, ctx, depth, out) {
  for (let ni = 0; ni < nodes.length; ni++) {
    const nd = nodes[ni];
    switch (nd.kind) {
      case 'text':
        out.push(nd.text);
        break;
      case 'var':
        out.push(ctx.escape(textOf(lookup(scope, nd.path))));
        break;
      case 'raw':
        out.push(textOf(lookup(scope, nd.path)));
        break;
      case 'if': {
        const v = truthy(lookup(scope, nd.path));
        const branch = v !== nd.not ? nd.then : nd.else;
        if (branch !== null) renderNodes(branch, scope, ctx, depth, out);
        break;
      }
      case 'for': {
        const xs = lookup(scope, nd.path);
        if (!Array.isArray(xs)) break;
        for (let k = 0; k < xs.length; k++) {
          const vars = { [nd.name]: xs[k], loop: { index: k + 1, first: k === 0, last: k === xs.length - 1, length: xs.length } };
          renderNodes(nd.body, { vars, parent: scope }, ctx, depth, out);
        }
        break;
      }
      case 'include': {
        const t = ctx.templates.get(nd.name);
        if (t !== undefined && depth < INCLUDE_DEPTH) renderNodes(t, scope, ctx, depth + 1, out);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- template codegen
// The same tree, compiled to a function once per template: the node walk, the
// switch and the recursive calls become straight-line pushes and native loops.
// Semantics are the interpreter's, statement for statement; where the sandbox
// refuses `new Function`, the interpreter above runs instead.
let canCompile = false;
try {
  new Function('return 1');
  canCompile = true;
} catch {
  canCompile = false;
}

const compiledCache = new Map();

function compiledFor(nodes) {
  let fn = compiledCache.get(nodes);
  if (fn === undefined) {
    fn = canCompile ? compileTemplate(nodes) : (scope, ctx, depth, out) => renderNodes(nodes, scope, ctx, depth, out);
    compiledCache.set(nodes, fn);
  }
  return fn;
}

function includeRender(ctx, name, scope, depth, out) {
  if (depth >= INCLUDE_DEPTH) return;
  const nodes = ctx.templates.get(name);
  if (nodes === undefined) return;
  compiledFor(nodes)(scope, ctx, depth + 1, out);
}

function compileTemplate(nodes) {
  const paths = [];
  const pathMap = new Map();
  const pi = (p) => {
    const key = p.join('');
    let idx = pathMap.get(key);
    if (idx === undefined) {
      idx = paths.length;
      paths.push(p);
      pathMap.set(key, idx);
    }
    return idx;
  };
  const code = [];
  const gen = (ns) => {
    for (const nd of ns) {
      switch (nd.kind) {
        case 'text':
          code.push(`O.push(${JSON.stringify(nd.text)});`);
          break;
        case 'var':
          code.push(`O.push(C.escape(T(L(S,P[${pi(nd.path)}]))));`);
          break;
        case 'raw':
          code.push(`O.push(T(L(S,P[${pi(nd.path)}])));`);
          break;
        case 'if':
          code.push(`if(Y(L(S,P[${pi(nd.path)}]))!==${nd.not}){`);
          gen(nd.then);
          code.push('}');
          if (nd.else !== null) {
            code.push('else{');
            gen(nd.else);
            code.push('}');
          }
          break;
        case 'for':
          code.push(`{const X=L(S,P[${pi(nd.path)}]);if(Array.isArray(X)){for(let k=0;k<X.length;k++){S={vars:{${JSON.stringify(nd.name)}:X[k],loop:{index:k+1,first:k===0,last:k===X.length-1,length:X.length}},parent:S};`);
          gen(nd.body);
          code.push('S=S.parent;}}}');
          break;
        case 'include':
          code.push(`I(C,${JSON.stringify(nd.name)},S,D,O);`);
          break;
      }
    }
  };
  gen(nodes);
  const factory = new Function('L', 'T', 'Y', 'I', 'P', `return function(S,C,D,O){${code.join('')}}`);
  return factory(lookup, textOf, truthy, includeRender, paths);
}

// ---------------------------------------------------------------- build
const REPORT_FILE = 'build-report.txt';
const RESERVED = ['posts', 'tags', 'page'];
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Word count: runs of non-whitespace, as /\S+/g counts them.
function isSpaceCode(c) {
  if (c < 33) return c === 9 || c === 10 || c === 11 || c === 12 || c === 13 || c === 32;
  if (c < 160) return false;
  return c === 160 || c === 5760 || (c >= 8192 && c <= 8202) || c === 8232 || c === 8233 ||
    c === 8239 || c === 8287 || c === 12288 || c === 65279;
}

function wordsOf(text) {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    if (isSpaceCode(text.charCodeAt(i))) inWord = false;
    else if (!inWord) { inWord = true; n++; }
  }
  return n;
}

function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

// A target with a scheme (https:, mailto:, ...), per /^[A-Za-z][A-Za-z0-9+.-]*:/.
function hasScheme(target) {
  const colon = target.indexOf(':');
  if (colon <= 0) return false;
  const c0 = target.charCodeAt(0);
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return false;
  for (let i = 1; i < colon; i++) {
    const c = target.charCodeAt(i);
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46)) return false;
  }
  return true;
}

function readSources(b) {
  const files = [...b.input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  for (let k = 0; k < files.length; k++) {
    const f = files[k];
    if (f.path.endsWith('.md')) {
      const c = f.content;
      b.sources.push({ path: f.path, text: c.includes('\r') ? c.replace(/\r\n?/g, '\n') : c });
    } else b.statics.push({ path: f.path, content: f.content });
  }
}

function frontMatter(b) {
  const kept = [];
  for (const s of b.sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      b.report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    const own = RESERVED.find((d) => d !== 'posts' && s.path.startsWith(`${d}/`));
    if (own !== undefined) {
      b.report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      b.report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!b.templates.has(layout)) {
      b.report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      b.report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }
  b.sources = kept;
}

function permalinks(b) {
  const taken = new Map();
  const takenIn = (dir) => {
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? RESERVED : []);
      taken.set(dir, set);
    }
    return set;
  };
  for (const s of b.sources) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), takenIn(dir));
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${b.base}/${s.outDir}/`;
    b.bySource.set(s.path, s);
  }
}

function markdown(b) {
  const staticPaths = new Set(b.statics.map((f) => f.path));
  const linkCache = new Map();
  for (const s of b.sources) {
    const dir = dirOf(s.path);
    const env = {
      link: (target) => {
        // Cache the resolution only; the broken-link report names the source,
        // so that side effect still runs once per (source, target) pair.
        const key = `${dir}\n${target}`;
        let res = linkCache.get(key);
        if (res === undefined) {
          let href;
          let broken = false;
          if (hasScheme(target) || target.charCodeAt(0) === 47 || target.charCodeAt(0) === 35) href = target; // '/' or '#'
          else {
            const hash = target.indexOf('#');
            const rel = hash === -1 ? target : target.slice(0, hash);
            const frag = hash === -1 ? '' : target.slice(hash);
            const path = rel === '' ? null : resolvePath(dir, rel);
            if (path !== null && b.bySource.has(path)) href = `${b.bySource.get(path).url}${frag}`;
            else if (path !== null && staticPaths.has(path)) href = `${b.base}/${path}${frag}`;
            else {
              broken = true;
              href = target;
            }
          }
          res = { href, broken };
          linkCache.set(key, res);
        }
        if (res.broken) b.broken.add(`broken-link ${s.path} -> ${target}`);
        return res.href;
      },
    };
    const md = renderMarkdown(s.body, env);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }
}

function collections(b) {
  const posts = b.sources.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  b.posts = posts;
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });
}

function tags(b) {
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    const tags = s.data.tags ?? [];
    for (let k = 0; k < tags.length; k++) {
      const name = tags[k];
      const slug = slugify(name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      out.push(name);
    }
    return out;
  };
  for (const p of b.posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${b.base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of b.sources) {
    if (s.post) continue;
    s.tagRefs = ownTags(s).map((name) => bySlug.get(slugify(name)) ?? { name, slug: slugify(name), url: '', posts: [] });
  }
  b.tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));
}

const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });

function cardOf(s) {
  return {
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  };
}

// A page as its layout reads it: the post's card (or a fresh one for a page),
// with the page's own fields set on it. The dialect never enumerates an object's
// keys, so the extra fields on a card shared with the lists are unobservable —
// and it saves a spread plus a toc remap per page.
function pageOf(s) {
  const card = s.card ?? (s.card = cardOf(s));
  card.slug = s.slug;
  card.content = s.html;
  card.toc = s.toc;
  card.newer = linkOf(s.newer ?? null);
  card.older = linkOf(s.older ?? null);
  card.is_post = s.post;
  return card;
}

const tagOf = (b, t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => b.cards.get(p)) });

function layouts(b) {
  b.cards = new Map();
  for (const p of b.posts) {
    const card = cardOf(p);
    p.card = card;
    b.cards.set(p, card);
  }
  const site = { title: b.input.site.title, base_url: b.base };
  const allTags = b.tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = b.posts.slice(0, b.input.site.recent).map((p) => b.cards.get(p));
  const ctx = { templates: b.templates, escape: escapeHtml };
  const render = (name, vars) => {
    const nodes = b.templates.get(name);
    if (nodes === undefined) return null;
    const out = [];
    compiledFor(nodes)({ vars: { site, tags: allTags, recent, ...vars }, parent: null }, ctx, 0, out);
    return out.join('');
  };
  // The page renders share one scope: only `page` changes between them.
  const pageScope = { vars: { site, tags: allTags, recent, page: null }, parent: null };
  for (const s of b.sources) {
    const nodes = b.templates.get(s.layout);
    if (nodes === undefined) continue;
    const out = [];
    pageScope.vars.page = pageOf(s);
    compiledFor(nodes)(pageScope, ctx, 0, out);
    b.output[`${s.outDir}/index.html`] = out.join('');
  }
  const per = b.input.site.per_page;
  const pages = Math.max(1, Math.ceil(b.posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${b.base}/` : `${b.base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: b.posts.slice((k - 1) * per, k * per).map((p) => b.cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) b.output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of b.tags) {
    const html = render('tag', { tag: tagOf(b, t) });
    if (html !== null) b.output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) b.output['tags/index.html'] = tagsHtml;
  for (const f of b.statics) {
    if (Object.hasOwn(b.output, f.path)) b.report.push(`shadowed ${f.path}: a built page has its path`);
    else b.output[f.path] = f.content;
  }
}

function report(b) {
  const lines = [...b.report, ...b.broken].sort(byCodeUnits);
  const pages = b.sources.filter((s) => !s.post).length;
  lines.push(`built ${pages} pages, ${b.posts.length} posts, ${b.tags.length} tags and ${b.statics.length} static files`);
  b.output[REPORT_FILE] = `${lines.join('\n')}\n`;
}

const PIPELINE = [readSources, frontMatter, permalinks, markdown, collections, tags, layouts, report];

/** One site's output tree: path -> text. */
export function build(input) {
  const templates = new Map();
  const reportLines = [];
  const names = Object.keys(input.templates).sort(byCodeUnits);
  for (let k = 0; k < names.length; k++) {
    const name = names[k];
    try {
      templates.set(name, parseTemplateCached(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      reportLines.push(err.message);
    }
  }
  const b = {
    input,
    base: input.site.base_url.replace(/\/+$/, ''),
    templates,
    sources: [],
    statics: [],
    bySource: new Map(),
    broken: new Set(),
    report: reportLines,
    posts: [],
    tags: [],
    cards: new Map(),
    output: {},
  };
  for (const plugin of PIPELINE) plugin(b);
  return b.output;
}

/** makefun-site 1.0.0's answer for one case's input. */
export function run(input) {
  return build(input);
}
