import assert from 'node:assert/strict';
import { goldbugEncode as encode, goldbugDecode as decode } from '../src/core/goldbug.js';
import '../src/core/encodingExt3.js';
import { getOp } from '../src/core/registry.js';

// Published table and examples, checked independently of the product exports:
// https://www.dcode.fr/scarabee-or-poe
// https://www.dcode.fr/alphabet-alien-2-futurama
let checks = 0;
const equal = (actual, expected) => { assert.equal(actual, expected); checks++; };
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const symbols = '52-†81346,709*‡.$();?¶]¢:[';
equal(symbols.length, 26);
equal(new Set(symbols).size, 26);
for (let i = 0; i < 26; i++) {
  equal(encode(alphabet[i]), symbols[i]);
  equal(decode(symbols[i]), alphabet[i]);
}
for (const [plain, cipher] of [['DCODE', '†-‡†8'], ['GOLD', '3‡0†'], ['HELLO', '4800‡']]) {
  equal(encode(plain), cipher); equal(decode(cipher), plain);
}
equal(encode(alphabet), symbols); equal(decode(symbols), alphabet);
for (const [plain, cipher] of [['DCODE', '†§‡†8'], ['HELLO', '4811‡'], ['GOLD', '3‡1†']]) {
  equal(encode(plain, { alphabet: 'legacy' }), cipher);
  equal(decode(cipher, { alphabet: 'legacy' }), plain);
}
for (const mode of ['poe', 'legacy']) {
  for (const text of ['', '中文🙂', 'A 0123456789 $-[]\\', 'HELLO, WORLD!', alphabet]) {
    equal(decode(encode(text, { alphabet: mode }), { alphabet: mode }), text);
  }
}
assert.throws(() => decode('\\'), /GoldBug/); checks++;
equal(encode('DCODE', null), '†-‡†8');
const alien = getOp('alienAlphabet');
equal(alien.encode('FUTURAMA', { mode: 'futurama2' }), 'FZSMDDPP');
equal(alien.decode('FZSMDDPP', { mode: 'futurama2' }), 'FUTURAMA');
equal(alien.encode('ALIEN', { mode: 'futurama2' }), 'ALTXK');
equal(alien.decode('ALTXK', { mode: 'futurama2' }), 'ALIEN');
equal(alien.encode('ALIEN', { mode: 'unicode' }), '⏃⌰⟟⟒⋏');
equal(alien.decode('⏃⌰⟟⟒⋏', { mode: 'unicode' }), 'ALIEN');
console.log(JSON.stringify({ verdict: 'PASS', checks, goldbugTables: 2, alienExistingModeVerified: true }));
