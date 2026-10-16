import { artifactTitle, type ArtifactKind } from '../../components/jarvis/artifact';

/** The last artifact block (```artifact-html / -svg / -mermaid) in a reply, for the stage. */
export function lastArtifact(
  text: string,
): { format: ArtifactKind; code: string; title: string } | null {
  const blocks = [...text.matchAll(/```artifact-(html|svg|mermaid)[^\n]*\n([\s\S]*?)```/g)];
  const m = blocks.at(-1);
  const format = m?.[1] as ArtifactKind | undefined;
  const code = m?.[2]?.replace(/\n$/, '');
  if (!format || !code) return null;
  return { format, code: code.slice(0, 200_000), title: artifactTitle(format, code) };
}
