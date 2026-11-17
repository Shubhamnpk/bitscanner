import type { ReleaseEntry, ReleaseSection } from './releaseNotes';

export interface GithubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string | null;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
}

const GITHUB_RELEASES_URL =
  'https://api.github.com/repos/Shubhamnpk/bitscanner/releases';

function formatDate(date: string | null): string {
  if (!date) return 'TBD';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date));
}

function splitMarkdownSections(body: string | null): ReleaseSection[] {
  if (!body) return [];
  const sections: ReleaseSection[] = [];
  const lines = body.split(/\r?\n/);

  let currentTitle = 'Highlights';
  let currentItems: string[] = [];

  const pushSection = () => {
    const items = currentItems
      .map((item) => item.replace(/^\s*[-*+]\s+/, '').trim())
      .filter(Boolean);
    if (items.length > 0) {
      sections.push({
        title: currentTitle,
        items,
        tone:
          currentTitle.toLowerCase().includes('fix')
            ? 'fix'
            : currentTitle.toLowerCase().includes('improv')
              ? 'improvement'
              : 'new',
      });
    }
  };

  for (const line of lines) {
    const heading = line.match(/^#{2,4}\s+(.+)$/);
    if (heading) {
      pushSection();
      currentTitle = heading[1].replace(/[:(].*$/, '').trim() || 'Highlights';
      currentItems = [];
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      currentItems.push(line);
    }
  }

  pushSection();

  if (sections.length > 0) return sections;

  const fallbackItems = body
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*+]\s+/, '').trim())
    .filter(Boolean);

  return fallbackItems.length > 0 ? [{ title: 'Highlights', items: fallbackItems, tone: 'new' }] : [];
}

export function extractSummary(body: string | null): string {
  if (!body) return 'No release notes were provided.';
  const lines = body.trim().split(/\r?\n/);
  const introLines: string[] = [];
  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) break;
    if (line.trim()) {
      introLines.push(line.trim());
    } else if (introLines.length > 0) {
      break;
    }
  }
  return introLines.join(' ') || lines[0] || 'No release notes were provided.';
}

export function extractComments(body: string | null): string[] {
  if (!body) return [];
  const lines = body.split(/\r?\n/);
  let inNotes = false;
  const comments: string[] = [];
  for (const line of lines) {
    if (/^#{2,4}\s+notes/i.test(line)) {
      inNotes = true;
      continue;
    }
    if (inNotes) {
      if (/^#{1,4}\s+/.test(line) || /^[*_]{3,}/.test(line) || /^\*\*Full Changelog/i.test(line)) {
        break;
      }
      const trimmed = line.replace(/^\s*[-*+]\s+/, '').trim();
      if (trimmed) {
        comments.push(trimmed);
      }
    }
  }
  return comments;
}

export function mapGithubReleaseToEntry(release: GithubRelease): ReleaseEntry {
  const version = release.tag_name.replace(/^v/i, '');
  const title =
    release.name?.trim() ||
    (version === '0.0.1' ? 'First public release' : `Release ${version}`);
  const sections = splitMarkdownSections(release.body);
  const summary = extractSummary(release.body);
  const comments = extractComments(release.body);
  return {
    version,
    date: formatDate(release.published_at),
    title,
    summary,
    sections:
      sections.length > 0
        ? sections
        : [
            {
              title: 'Highlights',
              items: ['No structured highlights were provided.'],
              tone: 'new',
            },
          ],
    comments:
      comments.length > 0
        ? comments
        : ['Release notes parsed from GitHub releases.'],
  };
}

export async function fetchGithubReleases(signal?: AbortSignal): Promise<ReleaseEntry[]> {
  const response = await fetch(GITHUB_RELEASES_URL, {
    signal,
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) {
    throw new Error(`GitHub release fetch failed: ${response.status}`);
  }
  const releases = (await response.json()) as GithubRelease[];
  return releases
    .filter((release) => !release.draft)
    .map(mapGithubReleaseToEntry);
}