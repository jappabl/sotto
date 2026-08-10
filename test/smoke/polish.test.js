// AI Polish smoke: exercises the real local LLM when engine + model exist;
// skips cleanly otherwise (CI machines won't have the 2 GB model).
//
// Run: node test/smoke/polish.test.js

const path = require('path');
const os = require('os');
const assert = require('assert');
const { Polisher } = require('../../electron/polisher');

const p = new Polisher({
  modelsDir: path.join(os.homedir(), 'Library', 'Application Support', 'Sotto', 'models'),
  log: () => {},
});

(async () => {
  if (!p.available()) {
    console.log('POLISH_SMOKE_SKIP (llama.cpp or model not installed)');
    return;
  }
  const cases = [
    {
      input: 'You know what, forget the pizza place. Book the sushi spot instead.',
      must: [/sushi/i],
      mustNot: [/pizza/i],
    },
    {
      input: 'I actually enjoyed the movie a lot.',
      must: [/actually enjoyed the movie/i],
      mustNot: [],
    },
  ];
  for (const c of cases) {
    const out = await p.polish(c.input);
    console.log(' ', JSON.stringify(c.input), '→', JSON.stringify(out));
    assert.ok(out, 'polish returned null for: ' + c.input);
    for (const re of c.must) assert.ok(re.test(out), `${out} should match ${re}`);
    for (const re of c.mustNot) assert.ok(!re.test(out), `${out} should not match ${re}`);
  }
  // Command Mode instruction path.
  const edited = await p.applyInstruction('make this all lowercase', 'HELLO WORLD THIS IS A TEST');
  console.log('  command →', JSON.stringify(edited));
  assert.ok(edited && edited.toLowerCase().includes('hello world'), 'instruction failed');
  p.stop();
  console.log('POLISH_SMOKE_OK');
  process.exit(0);
})().catch((e) => {
  p.stop();
  console.error('POLISH_SMOKE_FAIL:', e.message);
  process.exit(1);
});
