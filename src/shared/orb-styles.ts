/**
 * Orb styles Sir can pick (Settings → General → Orb style; Design-system.md §6.1). Each one is a
 * canvas painter in renderer/components/jarvis/orb-styles/. Ideas gathered from voice-assistant
 * orbs (Siri, ChatGPT voice, Echo), sci-fi HUDs and Sir's reference images.
 */
export const ORB_STYLES = [
  {
    id: 'particles',
    label: 'Particle core',
    hint: 'A liquid sphere of glowing dots with orbiting shells',
  },
  { id: 'reactor', label: 'Arc reactor', hint: 'HUD rings, radar sweep and a plasma core' },
  { id: 'fluid', label: 'Fluid glass', hint: 'Colour blobs swirling in a glass sphere' },
  { id: 'cloud', label: 'Voice cloud', hint: 'A soft drifting cloud that swells as it speaks' },
  { id: 'liquid', label: 'Liquid metal', hint: 'A morphing blob with ripples' },
  { id: 'sun', label: 'Solar flare', hint: 'A burning core with a corona of rays' },
  { id: 'plasma', label: 'Plasma ball', hint: 'Lightning tendrils reaching for the glass' },
  { id: 'equalizer', label: 'Radial equalizer', hint: 'Audio bars around a ring' },
  { id: 'scope', label: 'Oscilloscope', hint: 'A glowing Lissajous trace' },
  { id: 'ring', label: 'Light ring', hint: 'A smart-speaker ring with a running light' },
  { id: 'blackhole', label: 'Black hole', hint: 'An accretion disk around the dark' },
  { id: 'galaxy', label: 'Galaxy', hint: 'Spiral arms of stars' },
  { id: 'aurora', label: 'Aurora', hint: 'Curtains of northern lights inside a dark sphere' },
  { id: 'waves', label: 'Voice waves', hint: 'Layered glowing waves that swell as it speaks' },
  { id: 'wormhole', label: 'Wormhole', hint: 'Rings rushing into a bright, twisting throat' },
  { id: 'tesseract', label: 'Tesseract', hint: 'A 4D cube turning through itself' },
  { id: 'iris', label: 'Iris', hint: 'Camera-aperture blades that open when it listens' },
  { id: 'swarm', label: 'Firefly swarm', hint: 'Glowing motes circling the core' },
  { id: 'crystal', label: 'Crystal', hint: 'Two counter-turning gems around a burning core' },
] as const;

export type OrbStyleId = (typeof ORB_STYLES)[number]['id'];
export const ORB_STYLE_IDS = ORB_STYLES.map((s) => s.id) as [OrbStyleId, ...OrbStyleId[]];
export const DEFAULT_ORB_STYLE: OrbStyleId = 'particles';
