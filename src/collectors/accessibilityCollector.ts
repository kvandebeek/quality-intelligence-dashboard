import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from 'playwright';
import type { AccessibilityIssue, AccessibilityReport, Severity } from '../models/types.js';

const enrichmentMap: Record<string, string> = {
  'color-contrast': 'Increase contrast ratio to meet WCAG AA threshold.',
  'image-alt': 'Provide meaningful alternative text for images.',
  'label': 'Ensure form controls have associated labels.'
};

function toSeverity(value: string | null | undefined): Severity {
  if (value === 'critical' || value === 'serious' || value === 'moderate' || value === 'minor') {
    return value;
  }
  return 'unknown';
}

export async function collectAccessibility(page: Page, url: string): Promise<AccessibilityReport> {
  const results = await new AxeBuilder({ page }).analyze();
  const issues: AccessibilityIssue[] = results.violations.map((violation): AccessibilityIssue => ({
    id: violation.id,
    impact: toSeverity(violation.impact),
    description: violation.description,
    help: violation.help,
    nodes: violation.nodes.length,
    tags: violation.tags,
    recommendation: enrichmentMap[violation.id] ?? 'Refer to WCAG technique guidance for this rule.'
  }));

  const counters: Record<Severity, number> = {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
    unknown: 0
  };

  for (const issue of issues) {
    counters[issue.impact] += 1;
  }

  return { url, issues, counters };
}
