/**
 * Usage Statistics Aggregator
 *
 * Reads usage log files and aggregates statistics for dashboard display.
 * Supports filtering by date range and provides multiple aggregation views.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { UsageEntry } from "./logger.js";

const LOG_DIR = join(homedir(), ".openclaw", "blockrun", "logs");

export type DailyStats = {
  date: string;
  totalRequests: number;
  totalCost: number;
  totalBaselineCost: number;
  totalSavings: number;
  avgLatencyMs: number;
  byTier: Record<string, { count: number; cost: number }>;
  byModel: Record<string, { count: number; cost: number }>;
};

export type AggregatedStats = {
  period: string;
  totalRequests: number;
  totalCost: number;
  totalBaselineCost: number;
  totalSavings: number;
  savingsPercentage: number;
  avgLatencyMs: number;
  avgCostPerRequest: number;
  byTier: Record<string, { count: number; cost: number; percentage: number }>;
  byModel: Record<string, { count: number; cost: number; percentage: number }>;
  dailyBreakdown: DailyStats[];
};

/**
 * Parse a JSONL log file into usage entries.
 * Handles both old format (without tier/baselineCost) and new format.
 */
async function parseLogFile(filePath: string): Promise<UsageEntry[]> {
  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    return lines.map((line) => {
      const entry = JSON.parse(line) as Partial<UsageEntry>;
      // Handle old format entries
      return {
        timestamp: entry.timestamp || new Date().toISOString(),
        model: entry.model || "unknown",
        tier: entry.tier || "UNKNOWN",
        cost: entry.cost || 0,
        baselineCost: entry.baselineCost || entry.cost || 0,
        savings: entry.savings || 0,
        latencyMs: entry.latencyMs || 0,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Get list of available log files sorted by date (newest first).
 */
async function getLogFiles(): Promise<string[]> {
  try {
    const files = await readdir(LOG_DIR);
    return files
      .filter((f) => f.startsWith("usage-") && f.endsWith(".jsonl"))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/**
 * Aggregate stats for a single day.
 */
function aggregateDay(date: string, entries: UsageEntry[]): DailyStats {
  const byTier: Record<string, { count: number; cost: number }> = {};
  const byModel: Record<string, { count: number; cost: number }> = {};
  let totalLatency = 0;

  for (const entry of entries) {
    // By tier
    if (!byTier[entry.tier]) byTier[entry.tier] = { count: 0, cost: 0 };
    byTier[entry.tier].count++;
    byTier[entry.tier].cost += entry.cost;

    // By model
    if (!byModel[entry.model]) byModel[entry.model] = { count: 0, cost: 0 };
    byModel[entry.model].count++;
    byModel[entry.model].cost += entry.cost;

    totalLatency += entry.latencyMs;
  }

  const totalCost = entries.reduce((sum, e) => sum + e.cost, 0);
  const totalBaselineCost = entries.reduce((sum, e) => sum + e.baselineCost, 0);

  return {
    date,
    totalRequests: entries.length,
    totalCost,
    totalBaselineCost,
    totalSavings: totalBaselineCost - totalCost,
    avgLatencyMs: entries.length > 0 ? totalLatency / entries.length : 0,
    byTier,
    byModel,
  };
}

/**
 * Get aggregated statistics for the last N days.
 */
export async function getStats(days: number = 7): Promise<AggregatedStats> {
  const logFiles = await getLogFiles();
  const filesToRead = logFiles.slice(0, days);

  const dailyBreakdown: DailyStats[] = [];
  const allByTier: Record<string, { count: number; cost: number }> = {};
  const allByModel: Record<string, { count: number; cost: number }> = {};
  let totalRequests = 0;
  let totalCost = 0;
  let totalBaselineCost = 0;
  let totalLatency = 0;

  for (const file of filesToRead) {
    const date = file.replace("usage-", "").replace(".jsonl", "");
    const filePath = join(LOG_DIR, file);
    const entries = await parseLogFile(filePath);

    if (entries.length === 0) continue;

    const dayStats = aggregateDay(date, entries);
    dailyBreakdown.push(dayStats);

    totalRequests += dayStats.totalRequests;
    totalCost += dayStats.totalCost;
    totalBaselineCost += dayStats.totalBaselineCost;
    totalLatency += dayStats.avgLatencyMs * dayStats.totalRequests;

    // Merge tier stats
    for (const [tier, stats] of Object.entries(dayStats.byTier)) {
      if (!allByTier[tier]) allByTier[tier] = { count: 0, cost: 0 };
      allByTier[tier].count += stats.count;
      allByTier[tier].cost += stats.cost;
    }

    // Merge model stats
    for (const [model, stats] of Object.entries(dayStats.byModel)) {
      if (!allByModel[model]) allByModel[model] = { count: 0, cost: 0 };
      allByModel[model].count += stats.count;
      allByModel[model].cost += stats.cost;
    }
  }

  // Calculate percentages
  const byTierWithPercentage: Record<string, { count: number; cost: number; percentage: number }> =
    {};
  for (const [tier, stats] of Object.entries(allByTier)) {
    byTierWithPercentage[tier] = {
      ...stats,
      percentage: totalRequests > 0 ? (stats.count / totalRequests) * 100 : 0,
    };
  }

  const byModelWithPercentage: Record<string, { count: number; cost: number; percentage: number }> =
    {};
  for (const [model, stats] of Object.entries(allByModel)) {
    byModelWithPercentage[model] = {
      ...stats,
      percentage: totalRequests > 0 ? (stats.count / totalRequests) * 100 : 0,
    };
  }

  const totalSavings = totalBaselineCost - totalCost;
  const savingsPercentage = totalBaselineCost > 0 ? (totalSavings / totalBaselineCost) * 100 : 0;

  return {
    period: days === 1 ? "today" : `last ${days} days`,
    totalRequests,
    totalCost,
    totalBaselineCost,
    totalSavings,
    savingsPercentage,
    avgLatencyMs: totalRequests > 0 ? totalLatency / totalRequests : 0,
    avgCostPerRequest: totalRequests > 0 ? totalCost / totalRequests : 0,
    byTier: byTierWithPercentage,
    byModel: byModelWithPercentage,
    dailyBreakdown: dailyBreakdown.reverse(), // Oldest first for charts
  };
}

/**
 * Format stats as ASCII table for terminal display.
 */
export function formatStatsAscii(stats: AggregatedStats): string {
  const lines: string[] = [];

  // Header
  lines.push("╔════════════════════════════════════════════════════════════╗");
  lines.push("║              ClawRouter Usage Statistics                   ║");
  lines.push("╠════════════════════════════════════════════════════════════╣");

  // Summary
  lines.push(`║  Period: ${stats.period.padEnd(49)}║`);
  lines.push(`║  Total Requests: ${stats.totalRequests.toString().padEnd(41)}║`);
  lines.push(`║  Total Cost: $${stats.totalCost.toFixed(4).padEnd(43)}║`);
  lines.push(
    `║  Baseline Cost (Opus): $${stats.totalBaselineCost.toFixed(4).padEnd(33)}║`,
  );
  lines.push(
    `║  💰 Total Saved: $${stats.totalSavings.toFixed(4)} (${stats.savingsPercentage.toFixed(1)}%)`.padEnd(61) + "║",
  );
  lines.push(`║  Avg Latency: ${stats.avgLatencyMs.toFixed(0)}ms`.padEnd(61) + "║");

  // Tier breakdown
  lines.push("╠════════════════════════════════════════════════════════════╣");
  lines.push("║  Routing by Tier:                                          ║");

  const tierOrder = ["SIMPLE", "MEDIUM", "COMPLEX", "REASONING"];
  for (const tier of tierOrder) {
    const data = stats.byTier[tier];
    if (data) {
      const bar = "█".repeat(Math.min(20, Math.round(data.percentage / 5)));
      const line = `║    ${tier.padEnd(10)} ${bar.padEnd(20)} ${data.percentage.toFixed(1).padStart(5)}% (${data.count})`;
      lines.push(line.padEnd(61) + "║");
    }
  }

  // Top models
  lines.push("╠════════════════════════════════════════════════════════════╣");
  lines.push("║  Top Models:                                               ║");

  const sortedModels = Object.entries(stats.byModel)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);

  for (const [model, data] of sortedModels) {
    const shortModel = model.length > 25 ? model.slice(0, 22) + "..." : model;
    const line = `║    ${shortModel.padEnd(25)} ${data.count.toString().padStart(5)} reqs  $${data.cost.toFixed(4)}`;
    lines.push(line.padEnd(61) + "║");
  }

  // Daily breakdown (last 7 days)
  if (stats.dailyBreakdown.length > 0) {
    lines.push("╠════════════════════════════════════════════════════════════╣");
    lines.push("║  Daily Breakdown:                                          ║");
    lines.push("║    Date        Requests    Cost      Saved                 ║");

    for (const day of stats.dailyBreakdown.slice(-7)) {
      const saved = day.totalBaselineCost - day.totalCost;
      const line = `║    ${day.date}   ${day.totalRequests.toString().padStart(6)}    $${day.totalCost.toFixed(4).padStart(8)}  $${saved.toFixed(4)}`;
      lines.push(line.padEnd(61) + "║");
    }
  }

  lines.push("╚════════════════════════════════════════════════════════════╝");

  return lines.join("\n");
}

/**
 * Generate HTML dashboard page with BlockRun design style.
 * Matches the design patterns from blockrun.ai
 */
export function generateDashboardHtml(stats: AggregatedStats): string {
  const tierData = Object.entries(stats.byTier).map(([tier, data]) => ({
    tier,
    count: data.count,
    percentage: data.percentage.toFixed(1),
  }));

  const modelData = Object.entries(stats.byModel)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([model, data]) => ({
      model: model.split("/").pop() || model,
      count: data.count,
      cost: data.cost.toFixed(4),
    }));

  // Benchmark comparison data: ClawRouter cost vs what it would cost with premium models
  const dailyData = stats.dailyBreakdown.map((day) => ({
    date: day.date,
    clawRouter: day.totalCost.toFixed(4),
    baseline: day.totalBaselineCost.toFixed(4), // Claude Opus 4 baseline
    requests: day.totalRequests,
  }));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ClawRouter Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #09090b;
      color: #fff;
      min-height: 100vh;
      line-height: 1.5;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem 1.5rem;
    }

    /* Header - BlockRun style */
    .header {
      padding-bottom: 2rem;
      margin-bottom: 2rem;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }
    .header-links {
      display: flex;
      gap: 1.5rem;
      align-items: center;
    }
    .header-links a {
      color: #71717a;
      text-decoration: none;
      font-size: 0.875rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      transition: color 0.2s;
    }
    .header-links a:hover { color: #fff; }
    .header-links svg { width: 16px; height: 16px; }
    .header h1 {
      font-size: 2.5rem;
      font-weight: 300;
      letter-spacing: -0.03em;
      color: #fff;
      margin-bottom: 0.5rem;
    }
    .header p {
      color: #a1a1aa;
      font-size: 0.875rem;
    }

    /* Stats grid - card style from BlockRun */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .stat-card {
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 0.5rem;
      padding: 1.25rem;
      background: rgba(24, 24, 27, 0.6);
    }
    .stat-card .label {
      font-size: 0.75rem;
      font-family: 'JetBrains Mono', monospace;
      color: #a1a1aa;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }
    .stat-card .value {
      font-family: 'JetBrains Mono', monospace;
      font-size: 1.5rem;
      font-weight: 500;
      color: #fff;
    }
    .stat-card.highlight .value {
      color: #22c55e;
    }

    /* Charts section */
    .charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2rem;
    }
    .chart-card {
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 0.5rem;
      padding: 1.5rem;
      background: rgba(24, 24, 27, 0.6);
    }
    .chart-card .section-label {
      font-size: 0.75rem;
      font-family: 'JetBrains Mono', monospace;
      color: #a1a1aa;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 1rem;
    }
    canvas { max-height: 260px; }

    /* Table section */
    .table-section {
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 0.5rem;
      padding: 1.5rem;
      background: rgba(24, 24, 27, 0.6);
      margin-bottom: 2rem;
    }
    .table-section .section-label {
      font-size: 0.75rem;
      font-family: 'JetBrains Mono', monospace;
      color: #a1a1aa;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 1rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 0.75rem 0;
      text-align: left;
      border-bottom: 1px dashed rgba(255,255,255,0.1);
      font-size: 0.875rem;
    }
    th {
      color: #71717a;
      font-weight: 400;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    td {
      color: #a1a1aa;
      font-family: 'JetBrains Mono', monospace;
    }
    td:first-child { color: #fff; font-family: 'Inter', sans-serif; font-weight: 300; }
    tr:last-child td { border-bottom: none; }

    /* Footer - BlockRun style */
    .footer {
      border-top: 1px solid rgba(255,255,255,0.1);
      padding-top: 1.5rem;
      margin-top: 1rem;
    }
    .footer-content {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 1.5rem;
    }
    .footer-links {
      display: flex;
      gap: 1.5rem;
      align-items: center;
    }
    .footer-links a {
      color: #71717a;
      text-decoration: none;
      font-size: 0.875rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      transition: color 0.2s;
    }
    .footer-links a:hover { color: #fff; }
    .footer-links svg { width: 16px; height: 16px; }
    .footer-meta {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      color: #a1a1aa;
      font-size: 0.75rem;
    }
    .footer-meta a {
      color: #71717a;
      text-decoration: none;
      transition: color 0.2s;
    }
    .footer-meta a:hover { color: #fff; }
    .footer-meta .sep { color: #52525b; }

    @media (max-width: 640px) {
      .charts-grid { grid-template-columns: 1fr; }
      .footer-content { flex-direction: column; align-items: flex-start; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <div class="header-top">
        <div></div>
        <div class="header-links">
          <a href="https://blockrun.ai" target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            blockrun.ai
          </a>
          <a href="https://x.com/BlockRunAI" target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            @BlockRunAI
          </a>
          <a href="https://github.com/OpenClaw/ClawRouter" target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            GitHub
          </a>
        </div>
      </div>
      <h1>ClawRouter Dashboard</h1>
      <p>Smart LLM routing analytics &bull; ${stats.period}</p>
    </header>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="label">Total Requests</div>
        <div class="value">${stats.totalRequests.toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="label">Actual Cost</div>
        <div class="value">$${stats.totalCost.toFixed(2)}</div>
      </div>
      <div class="stat-card highlight">
        <div class="label">Total Saved</div>
        <div class="value">$${stats.totalSavings.toFixed(2)}</div>
      </div>
      <div class="stat-card highlight">
        <div class="label">Savings Rate</div>
        <div class="value">${stats.savingsPercentage.toFixed(1)}%</div>
      </div>
      <div class="stat-card">
        <div class="label">Avg Latency</div>
        <div class="value">${stats.avgLatencyMs.toFixed(0)}ms</div>
      </div>
      <div class="stat-card">
        <div class="label">Per 1K Requests</div>
        <div class="value">$${(stats.avgCostPerRequest * 1000).toFixed(2)}</div>
      </div>
    </div>

    <div class="charts-grid">
      <div class="chart-card">
        <div class="section-label">Routing by Tier</div>
        <canvas id="tierChart"></canvas>
      </div>
      <div class="chart-card">
        <div class="section-label">Cost Benchmark: ClawRouter vs Claude Opus 4</div>
        <canvas id="dailyChart"></canvas>
      </div>
    </div>

    <div class="table-section">
      <div class="section-label">Top Models by Usage</div>
      <table>
        <thead>
          <tr><th>Model</th><th>Requests</th><th>Cost</th></tr>
        </thead>
        <tbody>
          ${modelData.map((m) => `<tr><td>${m.model}</td><td>${m.count}</td><td>$${m.cost}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>

    <footer class="footer">
      <div class="footer-content">
        <div class="footer-meta">
          <span>Powered by</span>
          <a href="https://github.com/coinbase/x402" target="_blank" rel="noopener noreferrer">x402</a>
          <span class="sep">&bull;</span>
          <a href="https://base.org" target="_blank" rel="noopener noreferrer">Base</a>
          <span class="sep">&bull;</span>
          <span>USDC</span>
        </div>
      </div>
    </footer>
  </div>

  <script>
    const tierData = ${JSON.stringify(tierData)};
    const dailyData = ${JSON.stringify(dailyData)};

    // Tier doughnut chart
    new Chart(document.getElementById('tierChart'), {
      type: 'doughnut',
      data: {
        labels: tierData.map(d => d.tier),
        datasets: [{
          data: tierData.map(d => d.count),
          backgroundColor: ['#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: '#a1a1aa',
              font: { family: "'JetBrains Mono', monospace", size: 11 },
              padding: 12
            }
          }
        }
      }
    });

    // Benchmark comparison bar chart
    new Chart(document.getElementById('dailyChart'), {
      type: 'bar',
      data: {
        labels: dailyData.map(d => d.date.slice(5)),
        datasets: [
          {
            label: 'Claude Opus 4 (baseline)',
            data: dailyData.map(d => parseFloat(d.baseline)),
            backgroundColor: '#ef4444',
            borderRadius: 3
          },
          {
            label: 'ClawRouter (actual)',
            data: dailyData.map(d => parseFloat(d.clawRouter)),
            backgroundColor: '#22c55e',
            borderRadius: 3
          }
        ]
      },
      options: {
        responsive: true,
        scales: {
          x: {
            ticks: { color: '#71717a', font: { family: "'JetBrains Mono', monospace", size: 10 } },
            grid: { color: 'rgba(255,255,255,0.05)' }
          },
          y: {
            ticks: {
              color: '#71717a',
              font: { family: "'JetBrains Mono', monospace", size: 10 },
              callback: function(value) { return '$' + value; }
            },
            grid: { color: 'rgba(255,255,255,0.05)' }
          }
        },
        plugins: {
          legend: {
            labels: {
              color: '#a1a1aa',
              font: { family: "'JetBrains Mono', monospace", size: 11 },
              padding: 12
            }
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                return context.dataset.label + ': $' + context.parsed.y.toFixed(4);
              }
            }
          }
        }
      }
    });

    // Auto-refresh every 30 seconds
    setTimeout(() => location.reload(), 30000);
  </script>
</body>
</html>`;
}
