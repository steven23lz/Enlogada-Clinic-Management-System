const test = require('node:test');
const assert = require('node:assert/strict');
const { matchesSignature } = require('../../src/utils/fileSignature');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj');

test('each accepted type is recognised from its own bytes', () => {
  assert.equal(matchesSignature('image/png', PNG), true);
  assert.equal(matchesSignature('image/jpeg', JPEG), true);
  assert.equal(matchesSignature('image/webp', WEBP), true);
  assert.equal(matchesSignature('application/pdf', PDF), true);
});

test('a PDF may carry a preamble, as a scanner writes one', () => {
  assert.equal(matchesSignature('application/pdf', Buffer.concat([Buffer.from('junk\n'), PDF])), true);
});

test('an empty file is nothing, whatever it says it is', () => {
  for (const type of ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']) {
    assert.equal(matchesSignature(type, Buffer.alloc(0)), false, type);
  }
});

test('words labelled as a picture are refused', () => {
  assert.equal(matchesSignature('image/png', Buffer.from('this is not a picture')), false);
  assert.equal(matchesSignature('image/jpeg', Buffer.from('<html><script>alert(1)</script></html>')), false);
  assert.equal(matchesSignature('application/pdf', Buffer.from('not a pdf at all')), false);
});

test('one real type labelled as another is refused', () => {
  assert.equal(matchesSignature('image/png', JPEG), false);
  assert.equal(matchesSignature('image/jpeg', PNG), false);
  assert.equal(matchesSignature('image/webp', Buffer.from('RIFFxxxxWAVE')), false);
});

test('a type this does not know is refused, not waved through', () => {
  assert.equal(matchesSignature('image/svg+xml', Buffer.from('<svg/>')), false);
  assert.equal(matchesSignature(undefined, PNG), false);
  assert.equal(matchesSignature('image/png', null), false);
});
