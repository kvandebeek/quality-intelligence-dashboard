import { SECTION_FILES, type SectionFile } from './data.js';

export type GlossaryTermId =
  | 'lcp'
  | 'cls'
  | 'inp'
  | 'fcp'
  | 'readiness'
  | 'dns'
  | 'tcp'
  | 'ttfb'
  | 'dcl'
  | 'load'
  | 'fp'
  | 'keyboardReachable'
  | 'possibleFocusTrap'
  | 'contrastSimulationScore'
  | 'baselineFound'
  | 'diffRatio'
  | 'passed';

export interface GlossaryTermDefinition {
  id: GlossaryTermId;
  label: string;
  expanded?: string;
  meaning: string;
  whyItMatters: string;
}

export interface SectionInfoContent {
  whatItIs: string;
  whyItMatters: string;
  howToRead: readonly string[];
  keyTerms: readonly GlossaryTermId[];
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

export const GLOSSARY_TERMS = {
  lcp: {
    id: 'lcp',
    label: 'LCP',
    expanded: 'Largest Contentful Paint',
    meaning: 'How long it takes until the main content on the page is visible.',
    whyItMatters: 'A lower LCP usually means users feel the page loads faster.'
  },
  cls: {
    id: 'cls',
    label: 'CLS',
    expanded: 'Cumulative Layout Shift',
    meaning: 'How much the page layout moves around while it loads.',
    whyItMatters: 'Layout movement is frustrating and can cause mis-clicks. Lower is better.'
  },
  inp: {
    id: 'inp',
    label: 'INP',
    expanded: 'Interaction to Next Paint',
    meaning: 'How quickly the page responds visually after a user action (click/tap/type).',
    whyItMatters: 'A lower INP feels more responsive and smoother.'
  },
  fcp: {
    id: 'fcp',
    label: 'FCP',
    expanded: 'First Contentful Paint',
    meaning: 'How long it takes before the first meaningful content appears (text/image).',
    whyItMatters: 'Earlier content helps perceived performance.'
  },
  readiness: {
    id: 'readiness',
    label: 'Readiness',
    meaning: 'A simple indicator that required metrics were collected and look usable (not missing/invalid).',
    whyItMatters: '100% means the result set is complete; lower values suggest missing measurements.'
  },
  dns: {
    id: 'dns',
    label: 'DNS',
    meaning: 'Time to find the server address for the website.',
    whyItMatters: 'Slow DNS can delay every request.'
  },
  tcp: {
    id: 'tcp',
    label: 'TCP',
    meaning: 'Time to open a network connection to the server.',
    whyItMatters: 'Slow connection setup adds delay before anything can download.'
  },
  ttfb: {
    id: 'ttfb',
    label: 'TTFB',
    expanded: 'Time To First Byte',
    meaning: 'Time until the first byte of the response is received from the server.',
    whyItMatters: 'High TTFB often points to slow server processing or network latency.'
  },
  dcl: {
    id: 'dcl',
    label: 'DCL',
    expanded: 'DOMContentLoaded',
    meaning: 'Time until the page’s basic structure is loaded (HTML parsed).',
    whyItMatters: 'It’s an early “page is usable” milestone, but not the full load.'
  },
  load: {
    id: 'load',
    label: 'Load',
    meaning: 'Time until the page load event fires (page and resources considered loaded).',
    whyItMatters: 'High values often correlate with slow, heavy pages.'
  },
  fp: {
    id: 'fp',
    label: 'FP',
    expanded: 'First Paint',
    meaning: 'Time until the browser draws anything at all.',
    whyItMatters: 'Earlier paint gives users faster feedback.'
  },
  keyboardReachable: {
    id: 'keyboardReachable',
    label: 'keyboardReachable',
    meaning: 'Whether key interactive elements can be reached using the keyboard only.',
    whyItMatters: 'Keyboard access is essential for many users. “true” is good.'
  },
  possibleFocusTrap: {
    id: 'possibleFocusTrap',
    label: 'possibleFocusTrap',
    meaning: 'Whether the keyboard focus might get “stuck” in a part of the page.',
    whyItMatters: 'Focus traps prevent users from navigating. “true” means you should verify and potentially fix.'
  },
  contrastSimulationScore: {
    id: 'contrastSimulationScore',
    label: 'contrastSimulationScore',
    meaning: 'A simplified score representing how readable text remains under contrast limitations.',
    whyItMatters: 'Higher is better; low scores suggest readability issues for users with vision impairments.'
  },
  baselineFound: {
    id: 'baselineFound',
    label: 'Baseline found',
    meaning: 'Whether a reference screenshot exists to compare against.',
    whyItMatters: 'Without a baseline, you can’t detect visual changes.'
  },
  diffRatio: {
    id: 'diffRatio',
    label: 'Diff ratio',
    meaning: 'How much the current screenshot differs from the baseline (relative difference).',
    whyItMatters: 'Higher values indicate more visual change; confirm if changes are expected.'
  },
  passed: {
    id: 'passed',
    label: 'Passed',
    meaning: 'Whether the visual comparison stayed within the allowed difference threshold.',
    whyItMatters: '“Yes” means no unexpected visual change was detected.'
  }
} as const satisfies Record<GlossaryTermId, GlossaryTermDefinition>;

export const SECTION_CATEGORIES = [
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'performance', label: 'Performance' },
  { id: 'network', label: 'Network' },
  { id: 'quality-reliability', label: 'Quality & Reliability' },
  { id: 'security-risk', label: 'Security & Risk' },
  { id: 'seo', label: 'SEO' },
  { id: 'visual', label: 'Visual' }
] as const satisfies readonly SectionCategoryDefinition[];

const baseTerms: readonly GlossaryTermId[] = [];

export const SECTION_DEFINITIONS = {
  'target-summary.json': {
    route: 'target-summary.json',
    label: 'target-summary',
    category: 'quality-reliability',
    info: {
      whatItIs: 'A high-level overview of the results for this specific URL.',
      whyItMatters: 'It gives a quick snapshot of overall quality without needing to open every detailed section.',
      howToRead: ['Review the overall score or status indicators.', 'Confirm the run completed for this URL.', 'Check run ID and environment details.', 'Use this summary to choose where to investigate next.'],
      keyTerms: baseTerms
    }
  },
  'a11y-beyond-axe.json': {
    route: 'a11y-beyond-axe.json',
    label: 'a11y-beyond-axe',
    category: 'accessibility',
    info: {
      whatItIs: 'An extended accessibility analysis that goes beyond standard automated checks.',
      whyItMatters: 'It flags issues that can block keyboard and low-vision users even when basic scans look fine.',
      howToRead: ['Check each flag value first.', 'Treat possible focus traps as a manual review priority.', 'Use contrast simulation as a readability risk indicator.', 'Address issues that block navigation before cosmetic fixes.'],
      keyTerms: ['keyboardReachable', 'possibleFocusTrap', 'contrastSimulationScore']
    }
  },
  'accessibility.json': {
    route: 'accessibility.json',
    label: 'accessibility',
    category: 'accessibility',
    info: {
      whatItIs: 'An automated accessibility scan of the page.',
      whyItMatters: 'Accessible pages are easier for more people to use and lower compliance risk.',
      howToRead: ['Look at issue counts by severity.', 'Prioritize critical and serious findings first.', 'Check repeated rule failures for systemic problems.', 'Track whether issue counts trend down over time.'],
      keyTerms: baseTerms
    }
  },
  'api-monitoring.json': {
    route: 'api-monitoring.json',
    label: 'api-monitoring',
    category: 'network',
    info: {
      whatItIs: 'A summary of how backend APIs responded during the test.',
      whyItMatters: 'Slow or failing APIs can make pages feel broken even if the frontend code is healthy.',
      howToRead: ['Review error rate before other metrics.', 'Check p95 latency for tail performance risk.', 'Use payload size to spot heavy responses.', 'Prioritize endpoints with high traffic and high latency.'],
      keyTerms: baseTerms
    }
  },
  'broken-links.json': {
    route: 'broken-links.json',
    label: 'broken-links',
    category: 'quality-reliability',
    info: {
      whatItIs: 'A scan of links that do not work or return errors.',
      whyItMatters: 'Broken links create dead ends for users and can hurt trust and discoverability.',
      howToRead: ['Start with total broken links.', 'Review redirect chains and loops separately.', 'Fix links on key journeys first.', 'Aim for zero broken links in production.'],
      keyTerms: baseTerms
    }
  },
  'core-web-vitals.json': {
    route: 'core-web-vitals.json',
    label: 'core-web-vitals',
    category: 'performance',
    info: {
      whatItIs: 'Google’s core user-experience metrics for loading, responsiveness, and layout stability.',
      whyItMatters: 'These metrics reflect how fast and stable the page feels to real users.',
      howToRead: ['Review LCP, CLS, INP, and FCP together.', 'Lower timing values are generally better.', 'Use readiness to confirm the metrics are complete.', 'Investigate outliers before averaging trends.'],
      keyTerms: ['lcp', 'cls', 'inp', 'fcp', 'readiness']
    }
  },
  'lighthouse-summary.json': {
    route: 'lighthouse-summary.json',
    label: 'lighthouse-summary',
    category: 'performance',
    info: {
      whatItIs: 'A summary of Lighthouse category scores for this page.',
      whyItMatters: 'It gives a quick, balanced quality snapshot across major web quality areas.',
      howToRead: ['Compare the category scores side by side.', 'Focus first on the lowest category.', 'Use this view for trend checks across runs.', 'Use detailed sections to investigate root causes.'],
      keyTerms: baseTerms
    }
  },
  'memory-profile.json': {
    route: 'memory-profile.json',
    label: 'memory-profile',
    category: 'performance',
    info: {
      whatItIs: 'A view of memory usage sampled while the page runs.',
      whyItMatters: 'High or growing memory usage can lead to slowdowns and instability.',
      howToRead: ['Check growth first.', 'Scan samples for spikes.', 'Compare with previous runs for regressions.', 'Investigate sustained upward trends.'],
      keyTerms: baseTerms
    }
  },
  'network-recommendations.json': {
    route: 'network-recommendations.json',
    label: 'network-recommendations',
    category: 'network',
    info: {
      whatItIs: 'Suggestions for improving resource loading behavior.',
      whyItMatters: 'Fixing high-impact network issues can reduce load time and bandwidth cost.',
      howToRead: ['Sort by severity and impacted count.', 'Review recommendation titles for quick wins.', 'Use descriptions to plan implementation work.', 'Tackle high severity items first.'],
      keyTerms: baseTerms
    }
  },
  'network-requests.json': {
    route: 'network-requests.json',
    label: 'network-requests',
    category: 'network',
    info: {
      whatItIs: 'A detailed list of requests captured during page load.',
      whyItMatters: 'This helps identify heavy, slow, or unnecessary requests.',
      howToRead: ['Sort by duration or transfer size.', 'Look for repeated requests to the same host.', 'Filter by domain when investigating third-party impact.', 'Focus on slow requests on critical page paths.'],
      keyTerms: baseTerms
    }
  },
  'performance.json': {
    route: 'performance.json',
    label: 'performance',
    category: 'performance',
    info: {
      whatItIs: 'Navigation and paint timing metrics for the page load lifecycle.',
      whyItMatters: 'These timings show where users wait during initial page loading.',
      howToRead: ['Read early timings (DNS/TCP/TTFB) first.', 'Compare DCL and Load to estimate page heaviness.', 'Use FP and FCP for perceived speed.', 'Investigate any timing that spikes between runs.'],
      keyTerms: ['dns', 'tcp', 'ttfb', 'dcl', 'load', 'fp', 'fcp']
    }
  },
  'security-scan.json': {
    route: 'security-scan.json',
    label: 'security-scan',
    category: 'security-risk',
    info: {
      whatItIs: 'A quick scan of security posture signals for the page.',
      whyItMatters: 'Security gaps can expose user data and increase business risk.',
      howToRead: ['Check TLS version first.', 'Review missing security headers.', 'Prioritize high-impact header gaps.', 'Confirm remediations in follow-up runs.'],
      keyTerms: baseTerms
    }
  },
  'seo-checks.json': {
    route: 'seo-checks.json',
    label: 'seo-checks',
    category: 'seo',
    info: {
      whatItIs: 'Checks for key metadata that supports search visibility.',
      whyItMatters: 'Missing or weak metadata can lower discoverability in search.',
      howToRead: ['Verify title and description presence.', 'Check canonical and robots values.', 'Review structured data count.', 'Fix missing metadata on priority pages first.'],
      keyTerms: baseTerms
    }
  },
  'stability.json': {
    route: 'stability.json',
    label: 'stability',
    category: 'quality-reliability',
    info: {
      whatItIs: 'A repeat-run stability view showing variation and potential instability.',
      whyItMatters: 'Unstable behavior can cause flaky user experience and noisy performance signals.',
      howToRead: ['Review unstable status and variation metrics.', 'Check load-event sample spread.', 'Spot repeated slow outliers.', 'Investigate causes when variability increases.'],
      keyTerms: baseTerms
    }
  },
  'third-party-risk.json': {
    route: 'third-party-risk.json',
    label: 'third-party-risk',
    category: 'security-risk',
    info: {
      whatItIs: 'An analysis of external domains and scripts used by the page.',
      whyItMatters: 'Third parties can add security, privacy, and performance risk.',
      howToRead: ['Review domains with highest request count.', 'Check high-byte domains for heavy payloads.', 'Assess tracker-flagged domains carefully.', 'Remove or defer low-value dependencies.'],
      keyTerms: baseTerms
    }
  },
  'throttled-run.json': {
    route: 'throttled-run.json',
    label: 'throttled-run',
    category: 'performance',
    info: {
      whatItIs: 'Performance results collected under slower network conditions.',
      whyItMatters: 'It shows how the experience changes for users on constrained networks.',
      howToRead: ['Confirm the run was available.', 'Compare baseline and throttled load time.', 'Use degradation factor to estimate impact.', 'Prioritize improvements that reduce throttled delay.'],
      keyTerms: baseTerms
    }
  },
  'visual-current.png': {
    route: 'visual-current.png',
    label: 'visual-current.png',
    category: 'visual',
    info: {
      whatItIs: 'A screenshot of the page captured during this run.',
      whyItMatters: 'It helps confirm what users actually saw at runtime.',
      howToRead: ['Verify layout and key content are present.', 'Check for clipping or rendering artifacts.', 'Compare with expected design intent.', 'Use with visual regression findings for context.'],
      keyTerms: baseTerms
    }
  },
  'visual-regression.json': {
    route: 'visual-regression.json',
    label: 'visual-regression',
    category: 'visual',
    info: {
      whatItIs: 'A comparison between the current screenshot and a saved baseline image.',
      whyItMatters: 'It helps detect unexpected visual changes before release.',
      howToRead: ['Check whether a baseline exists.', 'Review diff ratio to understand change size.', 'Use passed status to confirm threshold compliance.', 'Validate expected design updates manually.'],
      keyTerms: ['baselineFound', 'diffRatio', 'passed']
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
