import { SECTION_FILES, type SectionFile } from './data.js';

export interface SectionInfoContent {
  whatItIs: string;
  whyItMatters: string;
  howToRead: readonly string[];
}

export type SectionCategory =
  | 'accessibility'
  | 'performance'
  | 'network'
  | 'quality-reliability'
  | 'security-risk'
  | 'seo'
  | 'visual';

export interface SectionDefinition {
  route: SectionFile;
  label: string;
  category: SectionCategory;
  info: SectionInfoContent;
}

export interface SectionCategoryDefinition {
  id: SectionCategory;
  label: string;
}

export const SECTION_CATEGORIES = [
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'performance', label: 'Performance' },
  { id: 'network', label: 'Network' },
  { id: 'quality-reliability', label: 'Quality & Reliability' },
  { id: 'security-risk', label: 'Security & Risk' },
  { id: 'seo', label: 'SEO' },
  { id: 'visual', label: 'Visual' }
] as const satisfies readonly SectionCategoryDefinition[];

export const SECTION_DEFINITIONS = {
  'target-summary.json': {
    route: 'target-summary.json',
    label: 'target-summary',
    category: 'quality-reliability',
    info: {
      whatItIs: 'A high-level overview of the results for this specific URL.',
      whyItMatters: 'It gives a quick snapshot of overall quality without needing to open every detailed section.',
      howToRead: [
        'Look at the overall score or status indicators.',
        'Identify whether the run completed successfully.',
        'Check environment and run details.',
        'Use this as the starting point before diving deeper.'
      ]
    }
  },
  'a11y-beyond-axe.json': {
    route: 'a11y-beyond-axe.json',
    label: 'a11y-beyond-axe',
    category: 'accessibility',
    info: {
      whatItIs: 'An extended accessibility analysis that goes beyond standard automated checks.',
      whyItMatters: 'Some accessibility issues are not detected by basic tools. This section highlights deeper risks that may affect users with disabilities.',
      howToRead: [
        'Review any flagged issues.',
        'Focus on contrast, usability, and structural concerns.',
        'Pay attention to items marked as high impact.',
        'Consider these findings as potential user experience blockers.'
      ]
    }
  },
  'accessibility.json': {
    route: 'accessibility.json',
    label: 'accessibility',
    category: 'accessibility',
    info: {
      whatItIs: 'An automated accessibility scan of the page.',
      whyItMatters: 'Accessibility ensures that people with disabilities can use the website effectively.',
      howToRead: [
        'Look at the total number of issues found.',
        'Prioritize critical or serious violations.',
        'Check recurring issue types.',
        'Fewer issues generally indicate better compliance.'
      ]
    }
  },
  'api-monitoring.json': {
    route: 'api-monitoring.json',
    label: 'api-monitoring',
    category: 'network',
    info: {
      whatItIs: 'A summary of how backend APIs responded during the test.',
      whyItMatters: 'If APIs are slow or failing, the user experience will suffer.',
      howToRead: [
        'Check response times.',
        'Look for failed or error responses.',
        'Identify unstable endpoints.',
        'Consistent fast responses are ideal.'
      ]
    }
  },
  'broken-links.json': {
    route: 'broken-links.json',
    label: 'broken-links',
    category: 'quality-reliability',
    info: {
      whatItIs: 'A scan of links that do not work or return errors.',
      whyItMatters: 'Broken links damage user trust and harm SEO.',
      howToRead: [
        'Look at the number of broken links.',
        'Check which pages contain them.',
        'Prioritize fixing links that users click most often.',
        'Zero broken links is the goal.'
      ]
    }
  },
  'core-web-vitals.json': {
    route: 'core-web-vitals.json',
    label: 'core-web-vitals',
    category: 'performance',
    info: {
      whatItIs: 'Measurements of key performance indicators defined by Google.',
      whyItMatters: 'These metrics reflect real user experience, especially loading speed and visual stability.',
      howToRead: [
        'Focus on loading speed and visual shift scores.',
        'Green values are good, red indicates problems.',
        'Large layout shifts often frustrate users.',
        'Slow load times may impact search ranking.'
      ]
    }
  },
  'lighthouse-summary.json': {
    route: 'lighthouse-summary.json',
    label: 'lighthouse-summary',
    category: 'performance',
    info: {
      whatItIs: 'A summary of Lighthouse scores across performance, accessibility, SEO, and best practices.',
      whyItMatters: 'It provides a balanced quality overview using a widely recognized scoring model.',
      howToRead: [
        'Review category scores.',
        'Identify the lowest scoring category.',
        'Use it as a benchmark over time.',
        'Improvements should increase the overall score.'
      ]
    }
  },
  'memory-profile.json': {
    route: 'memory-profile.json',
    label: 'memory-profile',
    category: 'performance',
    info: {
      whatItIs: 'Information about how much memory the page consumes.',
      whyItMatters: 'High memory usage can slow down devices and cause crashes.',
      howToRead: [
        'Look for unusually high memory values.',
        'Compare with previous runs.',
        'Large spikes may indicate leaks.',
        'Stable memory usage is preferred.'
      ]
    }
  },
  'network-recommendations.json': {
    route: 'network-recommendations.json',
    label: 'network-recommendations',
    category: 'network',
    info: {
      whatItIs: 'Suggestions for improving how resources are loaded.',
      whyItMatters: 'Optimized resource loading improves speed and reduces bandwidth use.',
      howToRead: [
        'Review suggested optimizations.',
        'Look for large unused files.',
        'Check caching recommendations.',
        'Prioritize high-impact suggestions.'
      ]
    }
  },
  'network-requests.json': {
    route: 'network-requests.json',
    label: 'network-requests',
    category: 'network',
    info: {
      whatItIs: 'A detailed list of all network calls made while loading the page.',
      whyItMatters: 'Too many or slow requests increase load time.',
      howToRead: [
        'Count total requests.',
        'Identify slowest requests.',
        'Look for large file sizes.',
        'Fewer and faster requests are better.'
      ]
    }
  },
  'performance.json': {
    route: 'performance.json',
    label: 'performance',
    category: 'performance',
    info: {
      whatItIs: 'Overall performance timing metrics for the page.',
      whyItMatters: 'Slow pages reduce user satisfaction and conversion.',
      howToRead: [
        'Check time to first content.',
        'Review full load time.',
        'Compare against benchmarks.',
        'Aim for consistent fast performance.'
      ]
    }
  },
  'security-scan.json': {
    route: 'security-scan.json',
    label: 'security-scan',
    category: 'security-risk',
    info: {
      whatItIs: 'A scan for common security weaknesses.',
      whyItMatters: 'Security flaws expose users and the organization to risk.',
      howToRead: [
        'Review detected vulnerabilities.',
        'Focus on high-severity findings.',
        'Ensure HTTPS is properly configured.',
        'Address critical risks first.'
      ]
    }
  },
  'seo-checks.json': {
    route: 'seo-checks.json',
    label: 'seo-checks',
    category: 'seo',
    info: {
      whatItIs: 'Checks that determine how well the page is optimized for search engines.',
      whyItMatters: 'Poor SEO reduces visibility in search results.',
      howToRead: [
        'Verify presence of titles and descriptions.',
        'Check structured data.',
        'Look for missing metadata.',
        'Higher compliance improves discoverability.'
      ]
    }
  },
  'stability.json': {
    route: 'stability.json',
    label: 'stability',
    category: 'quality-reliability',
    info: {
      whatItIs: 'An evaluation of runtime errors or crashes during the test.',
      whyItMatters: 'Errors degrade reliability and trust.',
      howToRead: [
        'Look for console errors.',
        'Identify repeated failures.',
        'Zero runtime errors is ideal.',
        'Frequent errors suggest instability.'
      ]
    }
  },
  'third-party-risk.json': {
    route: 'third-party-risk.json',
    label: 'third-party-risk',
    category: 'security-risk',
    info: {
      whatItIs: 'An analysis of external scripts and services used by the page.',
      whyItMatters: 'Third-party services can introduce performance and security risks.',
      howToRead: [
        'Identify critical external providers.',
        'Check performance impact.',
        'Look for outdated libraries.',
        'Reduce unnecessary dependencies.'
      ]
    }
  },
  'throttled-run.json': {
    route: 'throttled-run.json',
    label: 'throttled-run',
    category: 'performance',
    info: {
      whatItIs: 'Performance results under simulated slower network conditions.',
      whyItMatters: 'Not all users have fast internet connections.',
      howToRead: [
        'Compare with normal run results.',
        'Identify major slowdowns.',
        'Check usability under limited bandwidth.',
        'Ensure acceptable experience on slower networks.'
      ]
    }
  },
  'visual-current.png': {
    route: 'visual-current.png',
    label: 'visual-current.png',
    category: 'visual',
    info: {
      whatItIs: 'A screenshot of the page during this test run.',
      whyItMatters: 'It shows what users actually saw.',
      howToRead: [
        'Verify layout correctness.',
        'Look for missing content.',
        'Check for rendering glitches.',
        'Compare with expected design.'
      ]
    }
  },
  'visual-regression.json': {
    route: 'visual-regression.json',
    label: 'visual-regression',
    category: 'visual',
    info: {
      whatItIs: 'A comparison between the current screenshot and a previous baseline.',
      whyItMatters: 'It detects unintended visual changes.',
      howToRead: [
        'Review highlighted differences.',
        'Confirm whether changes were intentional.',
        'Pay attention to layout shifts.',
        'Investigate unexpected differences.'
      ]
    }
  }
} as const satisfies Record<SectionFile, SectionDefinition>;

const sectionKeys = Object.keys(SECTION_DEFINITIONS);
if (sectionKeys.length !== SECTION_FILES.length) {
  throw new Error(`Section metadata mismatch: expected ${SECTION_FILES.length} definitions, found ${sectionKeys.length}`);
}

export const SECTION_GROUPS = SECTION_CATEGORIES.map((category) => ({
  ...category,
  sections: SECTION_FILES.filter((section) => SECTION_DEFINITIONS[section].category === category.id)
}));
