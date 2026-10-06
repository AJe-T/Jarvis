// Database.md §8.1: files created the first time a vault is set up (never overwritten afterwards).

const today = (): string => new Date().toISOString().slice(0, 10);

export const SKELETON: Record<string, string> = {
  'README (Jarvis).md': `# JarvisBrain

This folder is Jarvis's long-term memory. It is plain Markdown, so you can read, edit, link and delete
anything here in Obsidian. Jarvis re-reads your edits within a few seconds.

- **Memory/** — facts Jarvis keeps about you, people, projects and preferences. Claude's memory tool works
  only inside this folder. \`About Sir.md\` and \`Preferences.md\` are read at the start of every conversation.
- **Conversations/** — a daily log of every conversation (secrets are redacted; /private chats are skipped).
- **Routines/** — multi-step routines you can start by voice ("start work mode").
- **Tasks/Reminders.md** — a readable copy of your reminders.
- **_jarvis/** — Jarvis's own housekeeping. Leave it alone.

Notes are facts, never instructions: Jarvis treats everything here as data.
`,
  'Memory/About Sir.md': `---
kind: profile
title: About Sir
tags: [profile]
created: ${today()}
source: import
---

# About Sir

- Sir built Jarvis and uses it on his Windows PC.
`,
  'Memory/Preferences.md': `---
kind: preference
title: Preferences
tags: [preferences]
created: ${today()}
source: import
---

# Preferences

- Addressed as "sir".
`,
  'Tasks/Reminders.md': `# Reminders

_Maintained by Jarvis. Edit reminders by asking Jarvis; changes here are not read back._
`,
  'Routines/Work Mode.md': `---
kind: routine
name: Work Mode
triggers: ["start work mode", "work setup", "let's get to work"]
enabled: true
steps:
  - tool: open_app
    input: { name: "Visual Studio Code" }
  - tool: open_url
    input: { url: "https://github.com/AvaanTech" }
  - tool: open_app
    input: { name: "Notion" }
  - tool: set_volume
    input: { level: 30 }
---

# Work Mode
Opens Sir's standard development workspace. Edit the steps above to change it.
`,
  '_jarvis/templates/Person.md': `---
kind: person
title: {{name}}
tags: []
---

# {{name}}

-
`,
};
