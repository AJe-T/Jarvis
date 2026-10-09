import type { OrbStyleId } from '@shared/orb-styles';
import type { OrbStyleFactory } from '../orb-kit';
import { blackhole, galaxy, mandala, rain } from './cosmic';
import { cloud, fluid, liquid, plasma, sun } from './fluid';
import { atom, equalizer, globe, gyroscope, ring, scope, sonar } from './instruments';
import { particles } from './particles';
import { reactor } from './reactor';

/** Every orb style by id (the list and labels live in shared/orb-styles.ts). */
export const ORB_STYLE_FACTORIES: Record<OrbStyleId, OrbStyleFactory> = {
  particles,
  reactor,
  fluid,
  cloud,
  liquid,
  sun,
  plasma,
  equalizer,
  sonar,
  scope,
  globe,
  gyroscope,
  atom,
  ring,
  mandala,
  blackhole,
  galaxy,
  rain,
};
