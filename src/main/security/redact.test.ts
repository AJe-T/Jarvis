import { describe, expect, it } from 'vitest';
import { __test, redact, redactDeep, registerSecretValue } from './redact';

describe('redact', () => {
  it.each([
    ['anthropic key', 'key sk-ant-api03-AbCdEf1234567890_xyzXYZ-0987', 'anthropic_key'],
    ['github pat', 'github_pat_11ABCDEFG0123456789_abcdefghijklmnop', 'github_token'],
    ['ghp token', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'github_token'],
    [
      'jwt',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      'jwt',
    ],
    ['card', 'card 4111 1111 1111 1111 exp', 'card'],
    ['otp', 'your OTP is 482913', 'otp'],
    ['verification code', 'verification code: 5521', 'otp'],
    ['password', 'password: hunter2!', 'password'],
    ['aadhaar', 'aadhaar 2345 6789 0123', 'aadhaar'],
    ['pan', 'PAN ABCDE1234F', 'pan'],
    [
      'hex token',
      'token 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      'hex_token',
    ],
    ['base64 token', 'key Ab3dEf5hIj7lMn9pQr1tUv3xYz5bCd7fGh9j==', 'token'],
    [
      'private key',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----',
      'private_key',
    ],
  ])('redacts %s', (_label, input, type) => {
    expect(redact(input)).toContain(`[REDACTED:${type}]`);
  });

  it.each([
    'Open Visual Studio Code and Chrome, sir.',
    'Order #12345678 shipped on 2026-10-06.',
    'Call me at 3 pm; the meeting has 14 people.',
    'Version 1.2.3 of electron-builder',
    'The file is C:\\Users\\Sir\\Documents\\report-final.txt',
    'card ending 1234',
    'node_modules/@modelcontextprotocol/sdk/client/streamableHttp.js',
    'Remind me at 6 pm to call the courier office',
  ])('leaves normal prose alone: %s', (input) => {
    expect(redact(input)).toBe(input);
  });

  it('does not redact digit runs that fail Luhn', () => {
    expect(redact('4111 1111 1111 1112')).toBe('4111 1111 1111 1112');
    expect(__test.luhnValid('0000000000000')).toBe(false);
  });

  it('redacts registered secret values of any shape', () => {
    registerSecretValue('plain-looking-secret');
    expect(redact('x plain-looking-secret y')).toBe('x [REDACTED:secret] y');
  });

  it('redacts deeply without mutating the input', () => {
    const input = { a: ['sk-ant-api03-AbCdEf1234567890_xyz'], b: { c: 1 } };
    const out = redactDeep(input);
    expect(out.a[0]).toContain('[REDACTED');
    expect(input.a[0]).toContain('sk-ant');
    expect(out.b.c).toBe(1);
  });
});
