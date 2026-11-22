// Fills banner.template.svg with live GitHub activity and writes banner.svg.
// Counts are contributions (commits, pull requests, issues, reviews). Private
// repositories only expose a combined number, so the two are added together.
import { readFile, writeFile } from 'node:fs/promises';

const login = process.env.GH_LOGIN || 'shimmykohn';
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error('GITHUB_TOKEN is not set');

const now = new Date();
const ago = hours => new Date(now.getTime() - hours * 3_600_000).toISOString();

const query = `
  query($login: String!, $d1: DateTime!, $d7: DateTime!, $now: DateTime!) {
    user(login: $login) {
      day: contributionsCollection(from: $d1, to: $now) { ...counts }
      week: contributionsCollection(from: $d7, to: $now) { ...counts }
      year: contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount } }
        }
      }
    }
  }
  fragment counts on ContributionsCollection {
    totalCommitContributions
    totalIssueContributions
    totalPullRequestContributions
    totalPullRequestReviewContributions
    restrictedContributionsCount
  }`;

const response = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'profile-banner' },
  body: JSON.stringify({ query, variables: { login, d1: ago(24), d7: ago(24 * 7), now: now.toISOString() } }),
});
const body = await response.json();
if (!response.ok || body.errors || !body.data?.user) {
  throw new Error(`GitHub API failed: ${response.status} ${JSON.stringify(body.errors ?? body)}`);
}

const total = c =>
  c.totalCommitContributions + c.totalIssueContributions + c.totalPullRequestContributions +
  c.totalPullRequestReviewContributions + c.restrictedContributionsCount;

const { day, week, year } = body.data.user;
const days = year.contributionCalendar.weeks.flatMap(w => w.contributionDays);

// Consecutive days with activity, ending today (or yesterday if today is still empty).
let streak = 0;
for (let i = days.length - 1; i >= 0; i--) {
  if (days[i].contributionCount > 0) streak++;
  else if (i === days.length - 1) continue;
  else break;
}

const number = n => n.toLocaleString('en-US');
const stats = {
  H24: number(total(day)),
  D7: number(total(week)),
  YEAR: number(year.contributionCalendar.totalContributions),
  STREAK: `${streak} ${streak === 1 ? 'DAY' : 'DAYS'}`,
};

// Skip the write when nothing but the clock moved, so the job only commits real changes.
const previous = await readFile('stats.json', 'utf8').then(JSON.parse).catch(() => null);
const templateText = await readFile('banner.template.svg', 'utf8');
const unchanged = previous && JSON.stringify(previous.stats) === JSON.stringify(stats) && previous.template === templateText.length;
if (unchanged && !process.env.FORCE) {
  console.log('No change:', stats);
  process.exit(0);
}

const updated = 'UPDATED ' + new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
}).format(now).toUpperCase().replace(',', '') + ' ET';

const svg = templateText.replace(/\{\{(\w+)\}\}/g, (_, key) => ({ ...stats, UPDATED: updated })[key] ?? '');
await writeFile('banner.svg', svg);
await writeFile('stats.json', JSON.stringify({ stats, template: templateText.length }, null, 2) + '\n');
console.log('Updated:', stats, updated);
