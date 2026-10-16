/**
 * Groups for the Skills network. Skills carry no category of their own (agentskills.io has none),
 * so the group is read from the name and description: the first group whose words appear wins.
 * ponytail: keyword match; give SkillView a category from SKILL.md metadata if this misfiles many.
 */
export const SKILL_GROUPS: ReadonlyArray<{ group: string; words: RegExp }> = [
  {
    group: 'Security',
    words:
      /\b(secur\w*|vulnerab\w*|pentest|owasp|threat|auth\w*|secret|compliance|hipaa|phi|cve)\b/i,
  },
  {
    group: 'Design & UI',
    words:
      /\b(design\w*|ui|ux|css|figma|frontend|front-end|brand\w*|typograph\w*|colou?r|glass\w*|animation|landing|slides?|canvas|theme)\b/i,
  },
  {
    group: 'Testing & quality',
    words: /\b(test\w*|tdd|e2e|qa|review\w*|lint\w*|coverage|quality|verif\w*|debug\w*)\b/i,
  },
  {
    group: 'Data & research',
    words:
      /\b(data\w*|sql|analy\w*|research\w*|statistic\w*|chart\w*|dashboard\w*|metric\w*|scien\w*|bio\w*|chem\w*|genom\w*|dataset|notebook|query)\b/i,
  },
  {
    group: 'Writing & content',
    words:
      /\b(writ\w*|article\w*|blog|content|copy\w*|seo|social|post\w*|newsletter|email\w*|docs?|documentation|video\w*|media)\b/i,
  },
  {
    group: 'Business & ops',
    words:
      /\b(business|sales|market\w*|finance\w*|invoice\w*|billing|customer\w*|crm|lead\w*|hiring|legal|contract\w*|payroll|tax|logistic\w*|supply|inventory|investor\w*|product)\b/i,
  },
  {
    group: 'AI & agents',
    words: /\b(agent\w*|llm|prompt\w*|claude|mcp|model\w*|ai|eval\w*|rag|embedding\w*|skill\w*)\b/i,
  },
  {
    group: 'Code & dev',
    words:
      /\b(code|coding|program\w*|api|backend|database|deploy\w*|docker|git\w*|build\w*|refactor\w*|typescript|python|rust|golang|go|java|kotlin|swift|react|node|devops|cli|framework|library)\b/i,
  },
];

export const OTHER_GROUP = 'Other';

export function skillGroup(name: string, description: string): string {
  const text = `${name.replace(/[-_]/g, ' ')} ${description}`;
  return SKILL_GROUPS.find((g) => g.words.test(text))?.group ?? OTHER_GROUP;
}
