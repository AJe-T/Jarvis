import { create } from 'zustand';

type Status = 'disabled' | 'connecting' | 'ready' | 'error';

interface McpStore {
  status: Record<
    string,
    { status: Status; toolCount?: number | undefined; error?: string | undefined }
  >;
  setStatus(
    server: string,
    s: { status: Status; toolCount?: number | undefined; error?: string | undefined },
  ): void;
}

export const useMcpStore = create<McpStore>((set, get) => ({
  status: {},
  setStatus: (server, s) => set({ status: { ...get().status, [server]: s } }),
}));

export function useMcpIssues(): number {
  return useMcpStore((s) => Object.values(s.status).filter((x) => x.status === 'error').length);
}
