import type { OrbStyleId } from '@shared/orb-styles';
import type { OrbStyleFactory } from '../orb-kit';
import { blackhole, galaxy } from './cosmic';
import { cloud, fluid, liquid, plasma, sun } from './fluid';
import { equalizer, ring, scope } from './instruments';
import { particles } from './particles';
import { reactor } from './reactor';
import { aurora, crystal, iris, swarm, tesseract, waves, wormhole } from './signature';

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
  scope,
  ring,
  blackhole,
  galaxy,
  aurora,
  waves,
  wormhole,
  tesseract,
  iris,
  swarm,
  crystal,
};
