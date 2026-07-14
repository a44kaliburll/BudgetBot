// Chart.js theming + factory helpers following the dataviz spec:
// thin marks, 4px rounded data-ends, 2px lines, recessive grid, tooltips on.
(function () {
  'use strict';

  const compactFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  const ChartKit = {
    moneyCompact(n) {
      const sign = n < 0 ? '-' : '';
      return sign + '$' + compactFmt.format(Math.abs(n));
    },

    colors() {
      return {
        s: [1, 2, 3, 4, 5, 6, 7, 8].map(i => cssVar(`--s${i}`)),
        ink: cssVar('--ink'),
        ink2: cssVar('--ink-2'),
        ink3: cssVar('--ink-3'),
        grid: cssVar('--grid'),
        baseline: cssVar('--baseline'),
        surface: cssVar('--surface'),
        surface2: cssVar('--surface-2'),
        good: cssVar('--good'),
        critical: cssVar('--critical'),
        accent: cssVar('--accent'),
        border: cssVar('--border-strong')
      };
    },

    slot(i) { return cssVar(`--s${U.clamp(i, 1, 8)}`); },

    alpha(hex, a) {
      const h = hex.replace('#', '');
      const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${a})`;
    },

    _base(money = true) {
      const c = this.colors();
      return {
        maintainAspectRatio: false,
        animation: { duration: 250 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: c.surface2,
            titleColor: c.ink,
            bodyColor: c.ink2,
            borderColor: c.border,
            borderWidth: 1,
            cornerRadius: 8,
            padding: 10,
            boxPadding: 4,
            usePointStyle: true,
            callbacks: money ? {
              label: (ctx) => {
                const v = ctx.parsed.y != null ? ctx.parsed.y : ctx.parsed.x;
                return `${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${U.money(v)}`;
              }
            } : {}
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { color: c.baseline },
            ticks: { color: c.ink3, font: { size: 11 }, maxRotation: 0, autoSkipPadding: 12 }
          },
          y: {
            grid: { color: c.grid, drawTicks: false },
            border: { display: false },
            ticks: {
              color: c.ink3, font: { size: 11 }, padding: 8, maxTicksLimit: 6,
              callback: money ? (v) => this.moneyCompact(v) : undefined
            }
          }
        }
      };
    },

    // destroy-and-replace on a canvas
    make(canvas, config) {
      if (canvas._chart) canvas._chart.destroy();
      const chart = new Chart(canvas.getContext('2d'), config);
      canvas._chart = chart;
      return chart;
    },

    // ---- line / area ----
    // series: [{label, data, color, fill (bool|target), dashed, width}]
    line(canvas, { labels, series, money = true, yZero = false, tooltipFooter }) {
      const opts = this._base(money);
      if (yZero) opts.scales.y.beginAtZero = true;
      if (tooltipFooter) opts.plugins.tooltip.callbacks.footer = tooltipFooter;
      const datasets = series.map(s => ({
        label: s.label,
        data: s.data,
        borderColor: s.color,
        backgroundColor: s.bg || (s.fill ? this.alpha(s.color, 0.12) : s.color),
        fill: s.fill || false,
        borderWidth: s.width != null ? s.width : 2,
        borderDash: s.dashed ? [5, 4] : undefined,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: s.color,
        pointHoverBorderColor: this.colors().surface,
        pointHoverBorderWidth: 2,
        tension: 0.25,
        spanGaps: true
      }));
      return this.make(canvas, { type: 'line', data: { labels, datasets }, options: opts });
    },

    // ---- vertical bars ----
    bars(canvas, { labels, series, money = true, stacked = false }) {
      const opts = this._base(money);
      opts.scales.x.stacked = stacked;
      opts.scales.y.stacked = stacked;
      opts.scales.y.beginAtZero = true;
      const n = series.length;
      const datasets = series.map((s, i) => ({
        label: s.label,
        data: s.data,
        backgroundColor: s.color,
        // rounded data-end only (stacked: only the last segment gets the cap)
        borderRadius: stacked
          ? (i === n - 1 ? { topLeft: 4, topRight: 4 } : 0)
          : { topLeft: 4, topRight: 4 },
        borderSkipped: 'bottom',
        maxBarThickness: 26,
        categoryPercentage: 0.62,
        barPercentage: stacked ? 1 : 0.9,
        // 2px surface gap between stacked segments
        borderColor: stacked ? this.colors().surface : undefined,
        borderWidth: stacked ? { top: 2 } : 0
      }));
      return this.make(canvas, { type: 'bar', data: { labels, datasets }, options: opts });
    },

    // custom HTML legend (color never carries identity alone; text in ink tokens)
    legend(containerEl, items) {
      containerEl.innerHTML = `<div class="legend-row">${items.map(it =>
        `<span class="legend-item"><span class="legend-swatch" style="background:${it.color}"></span>${U.esc(it.label)}</span>`
      ).join('')}</div>`;
    }
  };

  window.ChartKit = ChartKit;
})();
