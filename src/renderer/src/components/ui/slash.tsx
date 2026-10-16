/** The HUD "// " prefix on section labels; the Soft style hides it (Design-system.md §3.7). */
export function Slash(): React.JSX.Element {
  return (
    <span className="hud-slash" aria-hidden>
      {'// '}
    </span>
  );
}
