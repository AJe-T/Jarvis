/** Can this PC draw WebGL? (Old drivers, remote desktops and GPU-blocked PCs can't.) Kept apart from
 * the 3D office so checking doesn't load three.js. */
export function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}
