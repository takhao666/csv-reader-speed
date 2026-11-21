// Benchmark: my solve.js vs csv-reader 1.0.0 on the kit's practice set
// (6 cases, 10.2 MB of CSV) and on a synthetic quote-free 10 MB file.
//   node tests/perf.mjs --kit <unpacked kit dir>
// Times run() only (the part that differs), median of 7 rounds, CPU time.
import { readFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';
setFlagsFromString('--no-incremental-marking');

const kitArg = process.argv.indexOf('--kit');
if (kitArg === -1) {
  console.error('usage: node tests/perf.mjs --kit <unpacked kit dir>');
  process.exit(2);
}
const kit = process.argv[kitArg + 1];
const { run: mine } = await import('../solve.js');
const { run: ref } = await import(`${kit}/baselines/csv-reader/solve.js`);

const cases = JSON.parse(readFileSync(`${kit}/practice/input/cases.json`, 'utf8'));
const totalChars = cases.reduce((s, c) => s + String(c.input.text).length, 0);
console.log(`cases=${cases.length} totalChars=${totalChars}`);

function bench(fn, label, rounds) {
  for (const c of cases) fn(c.input); // warm-up
  const times = [];
  for (let r = 0; r < rounds; r++) {
    const t0 = process.cpuUsage();
    for (const c of cases) fn(c.input);
    const t1 = process.cpuUsage(t0);
    times.push((t1.user + t1.system) / 1000);
  }
  times.sort((a, b) => a - b);
  const mid = times[Math.floor(times.length / 2)];
  console.log(`${label}: median CPU ${mid.toFixed(1)} ms (${(totalChars / 1e6 / (mid / 1000)).toFixed(1)} MB/s)`);
  return mid;
}

const refCpu = bench(ref, 'reference', 7);
const myCpu = bench(mine, 'mine     ', 7);
console.log(`speedup: ${(refCpu / myCpu).toFixed(2)}x`);

const lines = [];
for (let i = 0; i < 120000; i++) lines.push(`${i},alpha,bravo,123.45,2024-01-15,AB-12345,charlie,delta,echo,foxtrot,golf,hotel`);
const big = { text: 'id,w1,w2,n,d,code,w3,w4,w5,w6,w7,w8\n' + lines.join('\n'), header: true };
const t0 = process.cpuUsage(); for (let i = 0; i < 5; i++) ref(big); const t1 = process.cpuUsage(t0);
const t2 = process.cpuUsage(); for (let i = 0; i < 5; i++) mine(big); const t3 = process.cpuUsage(t2);
const refBig = (t1.user + t1.system) / 1000 / 5;
const myBig = (t3.user + t3.system) / 1000 / 5;
console.log(`clean 10 MB file per run: reference ${refBig.toFixed(1)} ms, mine ${myBig.toFixed(1)} ms, speedup ${(refBig / myBig).toFixed(2)}x`);
