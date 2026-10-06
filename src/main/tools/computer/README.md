# tools/computer/

Computer-Control mode (Phase 6). `geometry.ts` maps Claude's screenshot pixels ↔ physical pixels ↔ DIPs
(tested at 100/125/150 % scaling). `drivers.ts` wraps nut.js (mouse/keyboard, tracks held keys so the kill
switch can release them) and defines the screen source; `electron-screen.ts` captures the primary display
with `desktopCapturer`. `member-executor.ts` implements the 17 `computer_toolset_20260801` members behind the
desktop action policy. `computer-system.ts` registers `delegate_desktop_task` and runs the Desktop Operator
(`agent/desktop-operator.ts`) with the red overlay shown.
