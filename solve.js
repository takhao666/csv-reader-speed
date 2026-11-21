// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Behaviour is byte-for-byte identical to the reference (see README.md for the
// policy, reproduced from the kit's vendor/csv-reader/index.js):
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it is one quote, and each CRLF or lone CR inside it is read as LF;
//     what follows its closing quote, up to the next comma or line break, is
//     appended as it stands (quote_junk, when the field ends); a quote that never
//     closes is a literal character, and the text after it is read again as
//     unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it (every record when header is false), each padded with ""
//     (short_row, with fields: its field count) or cut (long_row, with extra: the
//     cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met, a field's quote_junk when
//     the field ends and a record's short_row or long_row when the record ends;
//     line is the 1-based line its record starts on, row its record's index in
//     rows (null for the header).
//
// Speed: the reference walks the text one character at a time and builds every
// field one character at a time. This reader instead
//   1. takes a fast path for a record that is one whole line with no quote and
//      no stray CR: the line is sliced once and split(',') natively;
//   2. reads any other record by jumping from one special character to the
//      next with String indexOf (native, allocation-free, no regex at all),
//      slicing whole spans, and keeping the next '"', CR and LF positions in
//      lazily refreshed cursors so no stretch of text is ever scanned twice;
//   3. never builds a field character by character, never uses a regex, and
//      allocates no per-character strings.

/** Field ended at a comma (the record goes on). */
const COMMA = 0;
/** Field ended at a line break (the record ends). */
const LINE_BREAK = 1;
/** Field ended at the end of the text (the record ends). */
const END = 2;

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes
  // (null: the header). Helpers read these as they stand.
  let recordLine = 1;
  let recordRow = null;

  // Lazily refreshed cursors: the next '"' / CR / LF at or after pos.
  // qPos and crPos are -2 unknown, -1 none left in the text (a -1 never needs
  // recomputing: once no quote or CR is left at or after a position, none is
  // left after any later one either). lfPos is -1 unknown, n none left.
  let qPos = -2;
  let crPos = -2;
  let lfPos = -1;

  // Reads unquoted characters onto `value` up to the next comma or line break:
  // a CR not followed by LF is dropped (stray_cr). Returns the field, how it
  // ended, and `added`, the characters kept by this call (the stray CRs dropped
  // on the way do not count; the starting `value` does not count).
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      if (crPos !== -1 && crPos < pos) crPos = text.indexOf('\r', pos);
      if (lfPos < pos) {
        lfPos = text.indexOf('\n', pos);
        if (lfPos === -1) lfPos = n;
      }
      const cComma = text.indexOf(',', pos);
      let end = lfPos;
      let kind = 1; // 0 comma, 1 line break, 2 end, 3 CRLF, 4 stray CR
      if (cComma !== -1 && cComma < end) {
        end = cComma;
        kind = 0;
      }
      // The CR check is independent: a stray CR before the comma still wins.
      if (crPos !== -1 && crPos < end) {
        end = crPos;
        kind = text.charCodeAt(crPos + 1) === 10 ? 3 : 4;
      } else if (kind === 1 && end === n) {
        kind = 2;
      }
      if (kind === 4) {
        if (end > pos) {
          added += end - pos;
          value += text.slice(pos, end);
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos = end + 1;
        continue;
      }
      if (end > pos) {
        added += end - pos;
        value += text.slice(pos, end);
      }
      if (kind === 0) {
        pos = end + 1;
        return { value, ended: COMMA, added };
      }
      if (kind === 3) {
        pos = end + 2;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      if (kind === 2) {
        pos = n;
        return { value, ended: END, added };
      }
      pos = end + 1;
      line += 1;
      return { value, ended: LINE_BREAK, added };
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    for (;;) {
      if (qPos !== -1 && qPos < pos) qPos = text.indexOf('"', pos);
      if (crPos !== -1 && crPos < pos) crPos = text.indexOf('\r', pos);
      if (lfPos < pos) {
        lfPos = text.indexOf('\n', pos);
        if (lfPos === -1) lfPos = n;
      }
      let idx = -1;
      let what = -1; // 0 quote, 1 CR, 2 LF
      if (qPos !== -1) {
        idx = qPos;
        what = 0;
      }
      if (crPos !== -1 && (idx === -1 || crPos < idx)) {
        idx = crPos;
        what = 1;
      }
      if (lfPos !== n && (idx === -1 || lfPos < idx)) {
        idx = lfPos;
        what = 2;
      }
      if (idx === -1) {
        // The quote never closes: it is a literal character, and the text after
        // it is read again as an unquoted field. pos moves back, so the
        // cursors are unknown again.
        pos = open + 1;
        line = openLine;
        qPos = -2;
        crPos = -2;
        lfPos = -1;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return readUnquoted('"');
      }
      if (what === 0) {
        if (text.charCodeAt(idx + 1) === 34) {
          if (idx > pos) value += text.slice(pos, idx);
          value += '"';
          pos = idx + 2;
          continue;
        }
        if (idx > pos) value += text.slice(pos, idx);
        pos = idx + 1;
        break; // closed
      }
      if (idx > pos) value += text.slice(pos, idx);
      // CRLF and a lone CR inside quotes are each one LF.
      value += '\n';
      line += 1;
      pos = what === 1 && text.charCodeAt(idx + 1) === 10 ? idx + 2 : idx + 1;
    }
    if (pos >= n) return { value, ended: END };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: COMMA };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  // Finishes a record: a line that held only stray CRs is left with no
  // characters and is no record (its stray_cr errors stay); otherwise the
  // header is taken, or the row is padded or cut to the first record's width.
  function finishRecord(fields, quoted) {
    if (fields.length === 1 && fields[0] === '' && !quoted) return;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: a record that is one whole line with no quote and no stray CR.
    // The line ends at the next LF (or the end of the text); a CR in the last
    // place before that LF is the CRLF ending, anything else stray is not.
    if (lfPos < pos) {
      lfPos = text.indexOf('\n', pos);
      if (lfPos === -1) lfPos = n;
    }
    if (qPos !== -1 && qPos < pos) qPos = text.indexOf('"', pos);
    if (crPos !== -1 && crPos < pos) crPos = text.indexOf('\r', pos);
    const lineEnd = lfPos;
    const hasQuote = qPos !== -1 && qPos < lineEnd;
    let segEnd = lineEnd;
    let clean = !hasQuote;
    if (clean && crPos !== -1 && crPos < lineEnd) {
      if (lineEnd !== n && crPos === lineEnd - 1) segEnd = lineEnd - 1;
      else clean = false;
    }
    if (clean) {
      const fields = text.slice(pos, segEnd).split(',');
      pos = lineEnd === n ? n : lineEnd + 1;
      if (lineEnd !== n) line += 1;
      finishRecord(fields, false);
      continue;
    }

    // Slow path: the record holds a quote or a stray CR, so read it field by
    // field, quoted fields and all, exactly as the reference does.
    const fields = [];
    let ended;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      const field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
      ended = field.ended;
    } while (ended === COMMA);
    finishRecord(fields, quoted);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
