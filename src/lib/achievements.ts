export type AchievementParts = {
  action: string
  metric: string
  impact: string
  tool: string
}

const METRIC_RE =
  /\b\d+(?:\.\d+)?%|\b\d+\+?\s*(?:x|times|users|customers|companies|months|years|\$|usd|inr|k|m)\b/i

const TOOL_HINTS =
  /\b(?:react|redis|node|typescript|python|aws|sql|figma|jira|amplitude|mixpanel|kafka|docker|kubernetes|graphql|next\.?js|postgres|mongodb|spark|tableau|looker|excel|notion)\b/i

const ACTION_VERBS =
  /^(led|built|designed|improved|reduced|increased|launched|owned|drove|created|optimized|delivered|shipped|migrated|automated|scaled|cut|grew|established|implemented|refactored|negotiated|partnered|analyzed|defined|introduced)\b/i

export function composeAchievement(parts: AchievementParts): string {
  const action = parts.action.trim()
  const metric = parts.metric.trim()
  const impact = parts.impact.trim()
  const tool = parts.tool.trim()

  let sentence = action.replace(/\.$/, '')
  if (metric) {
    if (/\bby\b/i.test(sentence) || /\d/.test(sentence)) {
      // already has numeric flavor
    } else {
      sentence = `${sentence} by ${metric}`
    }
  }
  if (impact && !sentence.toLowerCase().includes(impact.toLowerCase())) {
    sentence = `${sentence}, ${impact.replace(/^[a-z]/, (c) => c.toLowerCase())}`
  }
  if (tool && !new RegExp(tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(sentence)) {
    sentence = `${sentence} using ${tool}`
  }
  if (!sentence.endsWith('.')) sentence += '.'
  // Capitalize first letter
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

export function parseAchievementBullet(text: string): AchievementParts & { suggestions: string[] } {
  const raw = text.replace(/^\s*[-*]\s*/, '').trim()
  const suggestions: string[] = []

  const actionMatch = raw.match(ACTION_VERBS)
  const action = actionMatch ? actionMatch[0] : raw.split(/\s+/).slice(0, 3).join(' ')

  const metricMatch = raw.match(METRIC_RE)
  const metric = metricMatch ? metricMatch[0] : ''

  const toolMatch = raw.match(TOOL_HINTS)
  const tool = toolMatch ? toolMatch[0] : ''

  let impact = ''
  const impactMatch = raw.match(
    /(?:resulting in|leading to|which|enabling|to)\s+([^.,;]+)/i,
  )
  if (impactMatch) impact = impactMatch[1].trim()

  if (!metric) suggestions.push('Add a measurable outcome (%, time saved, revenue, users).')
  if (!ACTION_VERBS.test(raw)) suggestions.push('Start with a strong action verb.')
  if (!tool) suggestions.push('Name the tool, stack, or method used.')
  if (!impact) suggestions.push('Clarify business impact for the reader.')
  if (raw.length > 180) suggestions.push('Shorten — dense bullets get skipped in a skim.')

  return { action, metric, impact, tool, suggestions }
}

export function tagAchievementParts(text: string): Array<{ kind: string; text: string }> {
  const raw = text.replace(/^\s*[-*]\s*/, '').trim()
  const tags: Array<{ kind: string; text: string }> = []
  let remaining = raw

  const verb = remaining.match(ACTION_VERBS)
  if (verb) {
    tags.push({ kind: 'action', text: verb[0] })
    remaining = remaining.slice(verb[0].length).trim()
  }

  const metric = remaining.match(METRIC_RE)
  if (metric) {
    tags.push({ kind: 'metric', text: metric[0] })
  }

  const tool = remaining.match(TOOL_HINTS)
  if (tool) {
    tags.push({ kind: 'tool', text: tool[0] })
  }

  const impact = remaining.match(/(?:resulting in|leading to|enabling)\s+([^.,;]+)/i)
  if (impact) {
    tags.push({ kind: 'impact', text: impact[1].trim() })
  }

  if (!tags.length) tags.push({ kind: 'text', text: raw })
  return tags
}

export function achievementSnippetTemplate(): string {
  return '- [Action] [metric] by [method/tool], [business impact].'
}
