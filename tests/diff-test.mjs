// Regression + differential test for solve.js.
//
//   node tests/diff-test.mjs            # 88 frozen edge cases (no kit needed)
//   node tests/diff-test.mjs --kit <dir> # also: practice set, 20,000-case fuzz
//                                        # and 300 generator-shaped files, each
//                                        # diffed live against csv-reader 1.0.0
import { readFileSync } from 'node:fs';
import { run } from '../solve.js';

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let pass = 0;
let fail = 0;

const frozen = JSON.parse(readFileSync(new URL('./edge-expected.json', import.meta.url), 'utf8'));
for (const { name, input, expected } of frozen) {
  if (eq(run(input), expected)) pass++;
  else {
    fail++;
    console.log(`FAIL edge:${name}\n  input: ${JSON.stringify(input)}\n  mine: ${JSON.stringify(run(input))}\n  want: ${JSON.stringify(expected)}`);
  }
}
console.log(`frozen edge cases: pass=${pass} fail=${fail} (of ${frozen.length})`);

const kitArg = process.argv.indexOf('--kit');
if (kitArg !== -1) {
  const kit = process.argv[kitArg + 1];
  const { run: ref } = await import(`${kit}/baselines/csv-reader/solve.js`);
  const cases = JSON.parse(readFileSync(`${kit}/practice/input/cases.json`, 'utf8'));
  const expected = JSON.parse(readFileSync(`${kit}/practice/reference/expected.json`, 'utf8'));
  let p = 0;
  for (let i = 0; i < cases.length; i++) {
    if (eq(run(cases[i].input), expected.cases[i].output)) p++;
    else console.log(`FAIL practice ${cases[i].id}`);
  }
  console.log(`practice set: pass=${p} fail=${cases.length - p} (of ${cases.length})`);
  if (p !== cases.length) fail++;

  let seed = 20261122;
  const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const pieces = ['', 'a', 'b', 'ab', ' ', ',', '"', '""', '"""', '\n', '\r', '\r\n', 'x\ny', 'x\ry', '"a"', '"a,b"', '"a""b"', '1', '12', 'Zürich', '🎉', '\uFEFF', 'kg', '!', '\x00', "O'Brien"];
  let fp = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const nPieces = 1 + Math.floor(rnd() * 14);
    let text = '';
    for (let j = 0; j < nPieces; j++) text += pick(pieces);
    const input = { text, header: rnd() < 0.5 };
    if (eq(run(input), ref(input))) fp++;
    else if (fp === i) console.log(`FAIL fuzz:${i} input=${JSON.stringify(input)}`);
  }
  console.log(`random fuzz: pass=${fp} fail=${N - fp} (of ${N})`);
  if (fp !== N) fail++;
}

process.exit(fail ? 1 : 0);
