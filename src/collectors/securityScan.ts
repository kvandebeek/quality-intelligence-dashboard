import tls from 'node:tls';

export const SECURITY_SCAN_SCHEMA_VERSION = '2.0.0';

export const SECURITY_HEADERS = {
  csp: 'content-security-policy',
  cspReportOnly: 'content-security-policy-report-only',
  hsts: 'strict-transport-security',
  xFrameOptions: 'x-frame-options',
  xContentTypeOptions: 'x-content-type-options',
  referrerPolicy: 'referrer-policy',
  permissionsPolicy: 'permissions-policy',
  coop: 'cross-origin-opener-policy',
  coep: 'cross-origin-embedder-policy',
  corp: 'cross-origin-resource-policy'
} as const;

type Severity = 'info' | 'low' | 'medium' | 'high';
type Status = 'pass' | 'missing' | 'weak' | 'info';

export type SecurityFinding = {
  id: string;
  title: string;
  status: Status;
  severity: Severity;
  message: string;
  evidence?: Record<string, unknown>;
  remediation?: string;
};

export type HeaderAssessment = {
  present: boolean;
  rawValue: string | null;
  status: Status;
  severity: Severity;
  message: string;
  findings: SecurityFinding[];
};

export type SecurityScanPayloadV2 = {
  summary: {
    overallStatus: 'pass' | 'info' | 'warning' | 'fail';
    severityCounts: Record<Severity, number>;
    topFindings: Array<{ id: string; severity: Severity; title: string; message: string }>;
  };
  headers: Record<keyof typeof SECURITY_HEADERS, HeaderAssessment>;
  hstsAnalysis: { directives: Record<string, string | boolean | null>; findings: SecurityFinding[] };
  cspAnalysis: { directives: Record<string, string[]>; findings: SecurityFinding[] };
  httpsEnforcement: {
    httpToHttps: { passed: boolean; chain: Array<{ status: number; location: string | null; url: string }>; finalUrl: string; status: number };
    tls: { scheme: 'https' | 'http'; protocol: string | null; cipher: string | null; reason?: string };
  };
  mixedContent: { hasMixedContent: boolean; items: Array<{ url: string; resourceType: string; initiator: string; classification: 'active' | 'passive' }>; counts: { active: number; passive: number } };
  httpLinksOnHttpsPage: { items: Array<{ href: string; linkText: string; domPath: string }>; count: number };
  insecureFormActions: { items: Array<{ action: string; method: string; domPath: string }>; count: number };
  cookies: { items: Array<{ name: string; domain: string | null; path: string | null; secure: boolean; httpOnly: boolean; sameSite: 'Strict' | 'Lax' | 'None' | null; hasExpiry: boolean; raw: string }>; findings: SecurityFinding[]; counts: { total: number; missingSecure: number; missingHttpOnly: number; sameSiteNoneWithoutSecure: number } };
  thirdParty: { scriptOrigins: Array<{ origin: string; scriptUrl: string; loaded: boolean }>; missingSRI: Array<{ scriptUrl: string; selector: string }>; counts: { origins: number; scripts: number; missingSri: number } };
};

export function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}

export function parseHstsDirectives(raw: string): Record<string, string | boolean | null> {
  const out: Record<string, string | boolean | null> = {};
  for (const part of raw.split(';').map((x) => x.trim()).filter(Boolean)) {
    const [k, ...rest] = part.split('=');
    const key = k.toLowerCase();
    if (rest.length === 0) out[key] = true;
    else out[key] = rest.join('=').trim();
  }
  out['max-age'] ??= null;
  out.includesubdomains ??= false;
  out.preload ??= false;
  return out;
}

export function parseCspDirectives(raw: string): Record<string, string[]> {
  const directives: Record<string, string[]> = {};
  for (const block of raw.split(';').map((x) => x.trim()).filter(Boolean)) {
    const [name, ...tokens] = block.split(/\s+/);
    directives[name.toLowerCase()] = tokens;
  }
  return directives;
}

export function parseSetCookieRedacted(raw: string): { name: string; domain: string | null; path: string | null; secure: boolean; httpOnly: boolean; sameSite: 'Strict' | 'Lax' | 'None' | null; hasExpiry: boolean; raw: string } {
  const [nameValue, ...attrs] = raw.split(';').map((x) => x.trim());
  const name = (nameValue.split('=')[0] ?? '').trim();
  let domain: string | null = null;
  let path: string | null = null;
  let sameSite: 'Strict' | 'Lax' | 'None' | null = null;
  let hasExpiry = false;
  let secure = false;
  let httpOnly = false;
  const attrNames: string[] = [];
  for (const attr of attrs) {
    const [k, ...rest] = attr.split('=');
    const key = k.toLowerCase();
    const value = rest.join('=').trim();
    if (key === 'domain') domain = value || null;
    if (key === 'path') path = value || null;
    if (key === 'secure') secure = true;
    if (key === 'httponly') httpOnly = true;
    if (key === 'samesite') {
      const normalized = value.toLowerCase();
      if (normalized === 'strict' || normalized === 'lax' || normalized === 'none') sameSite = normalized[0].toUpperCase() + normalized.slice(1) as 'Strict' | 'Lax' | 'None';
    }
    if (key === 'expires' || key === 'max-age') hasExpiry = true;
    attrNames.push(value ? `${k}=${value}` : k);
  }
  return { name, domain, path, secure, httpOnly, sameSite, hasExpiry, raw: `${name}=<redacted>${attrNames.length ? `; ${attrNames.join('; ')}` : ''}` };
}

export function classifyMixedContent(resourceType: string): 'active' | 'passive' {
  return ['script', 'xhr', 'fetch', 'websocket', 'iframe', 'document', 'eventsource', 'manifest'].includes(resourceType) ? 'active' : 'passive';
}

export async function probeRedirectChain(targetUrl: string): Promise<{ chain: Array<{ status: number; location: string | null; url: string }>; finalUrl: string; status: number }> {
  const parsed = new URL(targetUrl);
  const probe = new URL(targetUrl);
  probe.protocol = 'http:';
  let current = probe.toString();
  const chain: Array<{ status: number; location: string | null; url: string }> = [];
  for (let i = 0; i < 10; i += 1) {
    const res = await fetch(current, { method: 'GET', redirect: 'manual' });
    const location = res.headers.get('location');
    chain.push({ status: res.status, location, url: current });
    if (res.status < 300 || res.status >= 400 || !location) {
      return { chain, finalUrl: current, status: res.status };
    }
    current = new URL(location, current).toString();
  }
  return { chain, finalUrl: current, status: chain.at(-1)?.status ?? 0 };
}

export async function probeTls(targetUrl: string): Promise<{ scheme: 'https' | 'http'; protocol: string | null; cipher: string | null; reason?: string }> {
  const parsed = new URL(targetUrl);
  if (parsed.protocol !== 'https:') return { scheme: 'http', protocol: null, cipher: null, reason: 'Target is not HTTPS.' };
  return new Promise((resolve) => {
    const socket = tls.connect({ host: parsed.hostname, port: Number(parsed.port || 443), servername: parsed.hostname, rejectUnauthorized: false }, () => {
      const cipher = socket.getCipher();
      resolve({ scheme: 'https', protocol: socket.getProtocol() ?? null, cipher: cipher?.name ?? null });
      socket.end();
    });
    socket.on('error', (error) => resolve({ scheme: 'https', protocol: null, cipher: null, reason: error.message }));
    socket.setTimeout(5000, () => {
      resolve({ scheme: 'https', protocol: null, cipher: null, reason: 'TLS probe timed out.' });
      socket.destroy();
    });
  });
}

export function summarizeOverall(findings: SecurityFinding[]): SecurityScanPayloadV2['summary'] {
  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;
  const overallStatus = counts.high > 0 ? 'fail' : counts.medium > 0 ? 'warning' : counts.low > 0 ? 'info' : 'pass';
  const sortRank: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
  const topFindings = [...findings].sort((a, b) => sortRank[a.severity] - sortRank[b.severity] || a.id.localeCompare(b.id)).slice(0, 8).map((f) => ({ id: f.id, severity: f.severity, title: f.title, message: f.message }));
  return { overallStatus, severityCounts: counts, topFindings };
}
