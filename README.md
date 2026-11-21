# csv-reader-speed

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/takhao666/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/takhao666/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0: it answers exactly as the
reference does on every case, in a fraction of the CPU time. Built for
[make.fun's "Read broken CSV files faster" bounty](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
($100 in USDC).

## Run it

```sh
node main.ts
```

`main.ts` (Node 22) reads every case from `/input/cases.json` (or
`$MAKEFUN_INPUT_DIR`), answers each one with `run()` from `solve.js`, and
writes `/output/answers.json` (or `$MAKEFUN_OUTPUT_DIR`). It turns V8's
incremental marking off before importing `solve.js`, exactly as the house
baseline does. `solve.js` is a dependency-free ES module with one export,
`run(input)`, returning `{columns, rows, errors}` for an input
`{text, header}`.

## The reading policy (identical to csv-reader 1.0.0)

- A U+FEFF at the very start of the text is dropped.
- A record ends at LF or CRLF, and a line left with no characters is no record.
- Outside a quoted field a CR not followed by LF is dropped (`stray_cr`).
- A field that opens with a quote runs to the next quote that is not doubled
  (`""` inside it is one quote, and each CRLF or lone CR inside it is read as
  LF); what follows its closing quote, up to the next comma or line break, is
  appended as it stands (`quote_junk`, when the field ends); a quote that never
  closes is a literal character, and the text after it is read again as an
  unquoted field (`unterminated_quote`).
- A quote inside an unquoted field is a literal character.
- Fields stay strings, never trimmed or converted.
- `columns` is the first record when `header` is true, else null; `rows` holds
  the records after it (every record when `header` is false), each padded with
  `""` (`short_row`, with `fields`: its field count) or cut (`long_row`, with
  `extra`: the cut fields) to the first record's width.
- Each error is `{code, line, row}`, in the order met, a field's `quote_junk`
  when the field ends and a record's `short_row` or `long_row` when the record
  ends; `line` is the 1-based line its record starts on, `row` its record's
  index in `rows` (null for the header).

## Design: why it is faster

The reference walks the text one character at a time and builds every field
one character at a time. This reader never does either:

1. **Fast path for the common record.** A record that is one whole line with
   no quote and no stray CR is sliced once and `split(',')` natively — no
   per-field work at all. A CR in the last place before the line's LF is the
   CRLF ending; anything else stray sends the record to the slow path.
2. **Cursor-based slow path for the rest.** Records that hold quotes or stray
   CRs are read field by field, but by jumping from one special character to
   the next with `String` `indexOf` (native, allocation-free, no regex at
   all) and slicing whole spans. The next `"`, CR and LF positions are kept in
   lazily refreshed cursors, so no stretch of text is ever scanned twice —
   including inside multiline quoted fields and after an unterminated quote
   rewinds the read.
3. **No per-character strings, no regex, no backtracking, no extra
   allocation** beyond the output itself (rows, fields, error objects).

## Correctness

Every check below compares against csv-reader 1.0.0 itself (the kit's
baseline), and all of them pass:

| Check | Result |
| --- | --- |
| Kit practice set (6 cases, 10.2 MB), via `main.ts` + the kit scorer | 6/6, `passed: 1` |
| Frozen edge cases (`tests/diff-test.mjs`): BOM, CRLF/lone CR, quoted newlines, doubled quotes, quote junk, unterminated quotes, short/long rows, blank lines, non-string input | 88/88 |
| Random fuzz (`tests/diff-test.mjs --kit <kit>`): 20,000 random broken inputs | 20,000/20,000 |
| Generator-shaped fuzz: 300 files drawn like the competition's own generator (phrase/note columns, CRLF/LF, BOM, broken rows, unterminated-quote tails) | 300/300 |

```sh
node tests/diff-test.mjs            # frozen edge cases, no kit needed
node tests/diff-test.mjs --kit <unpacked kit dir>   # + practice, fuzz
node tests/perf.mjs --kit <unpacked kit dir>        # benchmark
```

## Performance

`run()` only, median of 7 rounds, CPU time, Node 24 on this machine
(`tests/perf.mjs --kit <kit>`; numbers move a little from run to run):

| Workload | csv-reader 1.0.0 | This reader | Speedup |
| --- | --- | --- | --- |
| Practice set, 10.2 MB of CSV | ~660–770 ms | ~130–160 ms | **≈4.2–5.9×** |
| Synthetic quote-free 10 MB file | ~315–355 ms | ~114–137 ms | **≈2.4–3.1×** |

---

<sub>Entered on [make.fun](https://make.fun/?ref=hvn9m3q0&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
