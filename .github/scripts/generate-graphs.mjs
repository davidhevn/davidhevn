import fs from 'fs';
import path from 'path';

async function fetchContributions(username, token) {
  const query = `
    query($userName: String!) {
      user(login: $userName) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                contributionCount
                date
              }
            }
          }
        }
      }
    }
  `;

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'davidhevn-stats-generator',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query,
      variables: { userName: username },
    }),
  });

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL Error: ${JSON.stringify(json.errors)}`);
  }
  return json.data.user.contributionsCollection.contributionCalendar;
}

function calculateStreaks(days) {
  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;

  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    if (day.contributionCount > 0) {
      tempStreak++;
      if (tempStreak > longestStreak) {
        longestStreak = tempStreak;
      }
    } else {
      tempStreak = 0;
    }
  }

  let idx = days.length - 1;
  if (idx >= 0 && days[idx].contributionCount === 0) {
    idx--;
  }

  while (idx >= 0 && days[idx].contributionCount > 0) {
    currentStreak++;
    idx--;
  }

  return {
    currentStreak,
    longestStreak,
    totalContributions: days.reduce((acc, d) => acc + d.contributionCount, 0),
  };
}

function generateActivityGraphSvg(days31) {
  const width = 800;
  const height = 280;
  const padLeft = 50;
  const padRight = 30;
  const padTop = 75;
  const padBottom = 45;

  const graphW = width - padLeft - padRight;
  const graphH = height - padTop - padBottom;

  const counts = days31.map(d => d.contributionCount);
  const maxCount = Math.max(...counts, 10);
  const totalMonth = counts.reduce((a, b) => a + b, 0);
  const avgMonth = (totalMonth / days31.length).toFixed(1);

  const points = days31.map((d, i) => {
    const x = padLeft + (i / (days31.length - 1)) * graphW;
    const y = padTop + graphH - (d.contributionCount / maxCount) * graphH;
    return { x, y, count: d.contributionCount, date: d.date };
  });

  let pathD = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    pathD += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }

  const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${(padTop + graphH).toFixed(1)} L ${points[0].x.toFixed(1)} ${(padTop + graphH).toFixed(1)} Z`;

  const gridLines = [];
  const ySteps = 4;
  for (let i = 0; i <= ySteps; i++) {
    const yVal = Math.round((maxCount / ySteps) * i);
    const yPos = padTop + graphH - (i / ySteps) * graphH;
    gridLines.push(`
      <line x1="${padLeft}" y1="${yPos}" x2="${width - padRight}" y2="${yPos}" stroke="#1e293b" stroke-dasharray="3,3" stroke-width="1"/>
      <text x="${padLeft - 10}" y="${yPos + 4}" fill="#64748b" font-size="10" text-anchor="end" font-family="Consolas, monospace">${yVal}</text>
    `);
  }

  const xLabels = [];
  days31.forEach((d, i) => {
    if (i % 5 === 0 || i === days31.length - 1) {
      const p = points[i];
      const parts = d.date.split('-');
      const label = `${parts[1]}/${parts[2]}`;
      xLabels.push(`
        <text x="${p.x.toFixed(1)}" y="${padTop + graphH + 20}" fill="#64748b" font-size="10" text-anchor="middle" font-family="Consolas, monospace">${label}</text>
      `);
    }
  });

  const peakPoints = points
    .filter((p, i) => p.count > 0 && (p.count === maxCount || i === points.length - 1 || p.count >= maxCount * 0.7))
    .map(p => `
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="#38bdf8" stroke="#0f172a" stroke-width="2">
        <animate attributeName="r" values="4;5.5;4" dur="2.5s" repeatCount="indefinite"/>
      </circle>
    `).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="50%" stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#c084fc"/>
    </linearGradient>
    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.35"/>
      <stop offset="50%" stop-color="#818cf8" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="borderGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"><animate attributeName="stop-color" values="#38bdf8;#818cf8;#c084fc;#38bdf8" dur="6s" repeatCount="indefinite"/></stop>
      <stop offset="100%"><animate attributeName="stop-color" values="#c084fc;#38bdf8;#818cf8;#c084fc" dur="6s" repeatCount="indefinite"/></stop>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="3" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>

  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="14" fill="#0f172a" stroke="url(#borderGrad)" stroke-width="1.5"/>

  <g transform="translate(${padLeft}, 36)">
    <text x="0" y="0" fill="#38bdf8" font-size="16" font-weight="bold" font-family="'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">
      📈 31-Day Activity Graph
    </text>
    <text x="${graphW}" y="0" text-anchor="end" fill="#94a3b8" font-size="12" font-family="Consolas, monospace">
      <tspan fill="#38bdf8" font-weight="bold">${totalMonth}</tspan> commits (31d) · <tspan fill="#818cf8" font-weight="bold">${avgMonth}</tspan>/day · Peak: <tspan fill="#c084fc" font-weight="bold">${maxCount}</tspan>
    </text>
  </g>

  ${gridLines.join('\n')}
  <path d="${areaD}" fill="url(#areaGrad)"/>
  <path d="${pathD}" fill="none" stroke="url(#lineGrad)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>
  ${peakPoints}
  ${xLabels.join('\n')}
</svg>`;
}

function generateStreakSvg(streaks) {
  const width = 800;
  const height = 195;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <linearGradient id="streakBorder" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"><animate attributeName="stop-color" values="#38bdf8;#818cf8;#c084fc;#38bdf8" dur="6s" repeatCount="indefinite"/></stop>
      <stop offset="100%"><animate attributeName="stop-color" values="#c084fc;#38bdf8;#818cf8;#c084fc" dur="6s" repeatCount="indefinite"/></stop>
    </linearGradient>
    <linearGradient id="fireGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="50%" stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#c084fc"/>
    </linearGradient>
    <filter id="fireGlow">
      <feGaussianBlur stdDeviation="3" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>

  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="14" fill="#0f172a" stroke="url(#streakBorder)" stroke-width="1.5"/>

  <!-- Section 1: Total Contributions -->
  <g transform="translate(133, 95)" text-anchor="middle" font-family="'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">
    <text x="0" y="-12" fill="#38bdf8" font-size="28" font-weight="bold">${streaks.totalContributions.toLocaleString()}</text>
    <text x="0" y="15" fill="#94a3b8" font-size="13">Total Contributions</text>
    <text x="0" y="34" fill="#64748b" font-size="11" font-family="Consolas, monospace">All Time</text>
  </g>

  <!-- Divider 1 -->
  <line x1="266" y1="35" x2="266" y2="160" stroke="#1e293b" stroke-width="1"/>

  <!-- Section 2: Current Streak (Center) -->
  <g transform="translate(400, 95)" text-anchor="middle" font-family="'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">
    <circle cx="0" cy="-22" r="32" fill="none" stroke="#1e293b" stroke-width="4"/>
    <circle cx="0" cy="-22" r="32" fill="none" stroke="url(#fireGrad)" stroke-width="4" stroke-dasharray="180 20" stroke-linecap="round" filter="url(#fireGlow)"/>
    <text x="0" y="-13" fill="#ffffff" font-size="26" font-weight="bold">${streaks.currentStreak}</text>
    <text x="0" y="24" fill="#c084fc" font-size="14" font-weight="bold">🔥 Current Streak</text>
    <text x="0" y="44" fill="#38bdf8" font-size="11" font-family="Consolas, monospace">Active Days</text>
  </g>

  <!-- Divider 2 -->
  <line x1="533" y1="35" x2="533" y2="160" stroke="#1e293b" stroke-width="1"/>

  <!-- Section 3: Longest Streak -->
  <g transform="translate(666, 95)" text-anchor="middle" font-family="'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">
    <text x="0" y="-12" fill="#818cf8" font-size="28" font-weight="bold">${streaks.longestStreak}</text>
    <text x="0" y="15" fill="#94a3b8" font-size="13">Longest Streak</text>
    <text x="0" y="34" fill="#64748b" font-size="11" font-family="Consolas, monospace">Days Record</text>
  </g>
</svg>`;
}

async function main() {
  const username = process.env.GITHUB_USER || 'davidhevn';
  const token = process.env.GITHUB_TOKEN;
  const outDir = process.env.OUTPUT_DIR || path.join(process.cwd(), 'dist');

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log(`Fetching contributions for user: ${username}...`);
  const calendar = await fetchContributions(username, token);

  const allDays = [];
  for (const week of calendar.weeks) {
    for (const day of week.contributionDays) {
      allDays.push(day);
    }
  }

  const streaks = calculateStreaks(allDays);
  console.log(`Streaks calculated: Current=${streaks.currentStreak}, Longest=${streaks.longestStreak}, Total=${streaks.totalContributions}`);

  const days31 = allDays.slice(-31);

  const graphSvg = generateActivityGraphSvg(days31);
  const streakSvg = generateStreakSvg(streaks);

  const graphPath = path.join(outDir, 'github-activity-graph.svg');
  const streakPath = path.join(outDir, 'github-streak.svg');

  fs.writeFileSync(graphPath, graphSvg, 'utf8');
  fs.writeFileSync(streakPath, streakSvg, 'utf8');

  console.log(`Generated: ${graphPath}`);
  console.log(`Generated: ${streakPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
