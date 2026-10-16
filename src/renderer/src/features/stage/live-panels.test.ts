import { describe, expect, it } from 'vitest';
import { maskSecret, qrPath, sparkline, uptime } from './live-panels';

describe('stage live panels', () => {
  it('draws a QR code locally as one SVG path', () => {
    const { size, d } = qrPath('https://example.com');
    expect(size).toBe(25); // version 2 at error level M
    expect(d.startsWith('M0 0h1v1h-1z')).toBe(true); // finder pattern corner is dark
    expect(() => qrPath('x'.repeat(5000))).toThrow();
  });

  it('hides a Wi-Fi password in the caption but leaves other text alone', () => {
    expect(maskSecret('WIFI:T:WPA;S:Home;P:hunter2;;')).toBe('WIFI:T:WPA;S:Home;P:••••••;;');
    expect(maskSecret('WIFI:P:a\\;b;S:x;;')).toBe('WIFI:P:••••••;S:x;;');
    expect(maskSecret('https://x.test/?P:1')).toBe('https://x.test/?P:1');
  });

  it('formats uptime and the CPU sparkline', () => {
    expect(uptime(59)).toBe('0m');
    expect(uptime(3 * 3600 + 120)).toBe('3h 2m');
    expect(uptime(2 * 86_400 + 5 * 3600)).toBe('2d 5h');
    expect(sparkline([50])).toBe('');
    const pts = sparkline([0, 100]).split(' ');
    expect(pts.at(-1)).toBe('100.0,0.0');
    expect(pts[0]?.endsWith(',24.0')).toBe(true);
  });
});
