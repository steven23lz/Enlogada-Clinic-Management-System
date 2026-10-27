const test = require('node:test');
const assert = require('node:assert/strict');
const { isRecipientRejection } = require('../../src/config/email');

// Whose fault a failed send was. Only a refused recipient is the address's; everything else is the
// clinic's own mail account, and telling staff to "check the address" for it sends them after a
// correct address while nothing is leaving at all.

// Shaped as nodemailer 9's SMTPConnection._formatError builds them: code, command, responseCode.
test('a refused recipient is the address', () => {
  assert.equal(isRecipientRejection({ code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550, response: '550 5.1.1 The email account that you tried to reach does not exist' }), true);
  assert.equal(isRecipientRejection({ code: 'EENVELOPE', command: 'RCPT TO', responseCode: 553, response: '553 5.1.3 invalid address' }), true);
  assert.equal(isRecipientRejection({ code: 'EENVELOPE', command: 'API', message: 'Invalid recipient "a@@b"' }), true);
});

test("the clinic's own login, connection or quota is not the address", () => {
  assert.equal(isRecipientRejection({ code: 'EAUTH', responseCode: 535, response: '535-5.7.8 Username and Password not accepted' }), false);
  assert.equal(isRecipientRejection({ code: 'ECONNECTION' }), false);
  assert.equal(isRecipientRejection({ code: 'ETIMEDOUT' }), false);
  assert.equal(isRecipientRejection({ code: 'EENVELOPE', command: 'MAIL FROM', responseCode: 550, response: '550-5.4.5 Daily user sending limit exceeded' }), false);
  assert.equal(isRecipientRejection({ code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550, response: '550-5.4.5 Daily user sending limit exceeded' }), false);
  assert.equal(isRecipientRejection({ code: 'EENVELOPE', command: 'MAIL FROM', responseCode: 553, response: '553 sender rejected' }), false);
  assert.equal(isRecipientRejection({ code: 'EENVELOPE', command: 'RCPT TO', responseCode: 450, response: '450 try again later' }), false);
  assert.equal(isRecipientRejection({ code: 'EENVELOPE', command: 'DATA', responseCode: 554 }), false);
  assert.equal(isRecipientRejection(undefined), false);
});
