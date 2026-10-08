import { describe, expect, it } from 'vitest';
import { stripWakeWord, toJid } from './whatsapp';

describe('WhatsApp channel helpers', () => {
  it('only takes self-chat messages that start with the wake word', () => {
    expect(stripWakeWord('Jarvis, what is the weather?', 'Jarvis')).toBe('what is the weather?');
    expect(stripWakeWord('jarvis: open notepad', 'Jarvis')).toBe('open notepad');
    expect(stripWakeWord('Jarvis', 'Jarvis')).toBe('Hello');
    expect(stripWakeWord('Buy milk', 'Jarvis')).toBeNull();
    expect(stripWakeWord('Jarvisx do it', 'Jarvis')).toBeNull();
    expect(stripWakeWord('Buy milk', '')).toBe('Buy milk');
    expect(stripWakeWord('J.A.R.V.I.S hi', 'J.A.R.V.I.S')).toBe('hi');
  });

  it('turns phone numbers into WhatsApp ids', () => {
    expect(toJid('+91 98765 43210')).toBe('919876543210@s.whatsapp.net');
    expect(toJid('12')).toBeNull();
  });
});
