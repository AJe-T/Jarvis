/** Unit converter app (§5.2a): factors to each category's base unit. Temperature is special. */
export interface UnitCategory {
  id: string;
  label: string;
  units: Array<{ id: string; label: string; factor: number }>;
}

export const UNIT_CATEGORIES: UnitCategory[] = [
  {
    id: 'length',
    label: 'Length',
    units: [
      { id: 'mm', label: 'Millimetres', factor: 0.001 },
      { id: 'cm', label: 'Centimetres', factor: 0.01 },
      { id: 'm', label: 'Metres', factor: 1 },
      { id: 'km', label: 'Kilometres', factor: 1000 },
      { id: 'in', label: 'Inches', factor: 0.0254 },
      { id: 'ft', label: 'Feet', factor: 0.3048 },
      { id: 'yd', label: 'Yards', factor: 0.9144 },
      { id: 'mi', label: 'Miles', factor: 1609.344 },
    ],
  },
  {
    id: 'mass',
    label: 'Weight',
    units: [
      { id: 'mg', label: 'Milligrams', factor: 1e-6 },
      { id: 'g', label: 'Grams', factor: 0.001 },
      { id: 'kg', label: 'Kilograms', factor: 1 },
      { id: 't', label: 'Tonnes', factor: 1000 },
      { id: 'oz', label: 'Ounces', factor: 0.028349523125 },
      { id: 'lb', label: 'Pounds', factor: 0.45359237 },
    ],
  },
  {
    id: 'temperature',
    label: 'Temperature',
    units: [
      { id: 'C', label: 'Celsius', factor: 1 },
      { id: 'F', label: 'Fahrenheit', factor: 1 },
      { id: 'K', label: 'Kelvin', factor: 1 },
    ],
  },
  {
    id: 'volume',
    label: 'Volume',
    units: [
      { id: 'ml', label: 'Millilitres', factor: 0.001 },
      { id: 'l', label: 'Litres', factor: 1 },
      { id: 'tsp', label: 'Teaspoons (US)', factor: 0.00492892159375 },
      { id: 'tbsp', label: 'Tablespoons (US)', factor: 0.01478676478125 },
      { id: 'cup', label: 'Cups (US)', factor: 0.2365882365 },
      { id: 'floz', label: 'Fluid ounces (US)', factor: 0.0295735295625 },
      { id: 'gal', label: 'Gallons (US)', factor: 3.785411784 },
    ],
  },
  {
    id: 'speed',
    label: 'Speed',
    units: [
      { id: 'kmh', label: 'km/h', factor: 1 / 3.6 },
      { id: 'ms', label: 'm/s', factor: 1 },
      { id: 'mph', label: 'mph', factor: 0.44704 },
      { id: 'kn', label: 'Knots', factor: 1852 / 3600 },
    ],
  },
  {
    id: 'area',
    label: 'Area',
    units: [
      { id: 'm2', label: 'Square metres', factor: 1 },
      { id: 'km2', label: 'Square kilometres', factor: 1e6 },
      { id: 'ft2', label: 'Square feet', factor: 0.09290304 },
      { id: 'acre', label: 'Acres', factor: 4046.8564224 },
      { id: 'ha', label: 'Hectares', factor: 10_000 },
    ],
  },
  {
    id: 'time',
    label: 'Time',
    units: [
      { id: 's', label: 'Seconds', factor: 1 },
      { id: 'min', label: 'Minutes', factor: 60 },
      { id: 'h', label: 'Hours', factor: 3600 },
      { id: 'd', label: 'Days', factor: 86_400 },
      { id: 'wk', label: 'Weeks', factor: 604_800 },
    ],
  },
  {
    id: 'data',
    label: 'Data',
    units: [
      { id: 'B', label: 'Bytes', factor: 1 },
      { id: 'KB', label: 'Kilobytes (1000)', factor: 1e3 },
      { id: 'MB', label: 'Megabytes (1000²)', factor: 1e6 },
      { id: 'GB', label: 'Gigabytes (1000³)', factor: 1e9 },
      { id: 'TB', label: 'Terabytes (1000⁴)', factor: 1e12 },
      { id: 'GiB', label: 'Gibibytes (1024³)', factor: 1024 ** 3 },
    ],
  },
];

function toCelsius(v: number, from: string): number {
  if (from === 'F') return ((v - 32) * 5) / 9;
  if (from === 'K') return v - 273.15;
  return v;
}

function fromCelsius(c: number, to: string): number {
  if (to === 'F') return (c * 9) / 5 + 32;
  if (to === 'K') return c + 273.15;
  return c;
}

export function convert(value: number, category: string, from: string, to: string): number {
  if (category === 'temperature') return fromCelsius(toCelsius(value, from), to);
  const units = UNIT_CATEGORIES.find((c) => c.id === category)?.units ?? [];
  const a = units.find((u) => u.id === from);
  const b = units.find((u) => u.id === to);
  if (!a || !b) throw new Error('unknown unit');
  return (value * a.factor) / b.factor;
}
