/**
 * Client half of the usage statistics bundle.
 *
 * Registers a sidebar entry and its `main` panel: one page that aggregates the
 * provider-reported token usage of EVERY persisted session in this profile —
 * totals, peak, streaks, an activity heatmap, a daily trend, per-model usage
 * and the session ranking.
 *
 * The Host half folds the checkpointed `tokenUsage` rows and serves the result
 * at `/usage-stats/summary`; this module only renders it (and refetches on
 * demand). Daily figures attribute a session's whole usage to its last active
 * day, which the page states in its subtitle.
 */
window.__ModuleLoader__.load({
  id: 'dsh-usage-stats',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Locale namespace owned by this bundle. */
    const NS = 'usage-stats';
    /** `main` panel key and `sidebar.panellist` id: one identity for both slots. */
    const PANEL_ID = 'usage-stats';
    /** Summary endpoint served by this bundle's Host half. */
    const SUMMARY_URL = '/usage-stats/summary';
    /** Milliseconds in one local day (the page never spans a DST boundary). */
    const DAY_MS = 86400000;
    /** Heatmap columns: 53 weeks, the GitHub-style rolling year. */
    const HEATMAP_WEEKS = 53;
    /** Blue tints for the activity cells; artwork colors, not theme tokens. */
    const HEAT_TINTS = ['rgba(59,130,246,0.20)', 'rgba(59,130,246,0.42)', 'rgba(59,130,246,0.66)', 'rgba(59,130,246,0.92)'];

    /** Simplified Chinese dictionary and key-set source of truth. */
    const zh = {
      panel: '使用统计',
      'panel.chip': '应用用量',
      subtitle: '汇总本机所有会话的提供方上报用量；每日数据按会话最后活跃日归集。',
      refresh: '刷新',
      updated: '更新于 {time}',
      'state.loading': '正在读取统计…',
      'state.error': '读取统计失败：{message}',
      'state.empty': '还没有可展示的数据：本机暂无已落盘的会话用量。',
      'card.total': '累计 Token 数',
      'card.peak': '峰值 Token 数',
      'card.sessions': '有用量会话',
      'card.current': '当前连续天数',
      'card.longest': '最长连续天数',
      'card.hint.peak': '单会话最高',
      'card.hint.sessions': '共 {count} 个检查点',
      'card.hint.days': '天',
      'card.hint.mix': '输入 {input} · 缓存读取 {cacheRead} · 输出 {output}',
      'heat.title': 'Token 活动',
      'heat.daily': '每日',
      'heat.weekly': '每周',
      'heat.cumulative': '累计',
      'heat.less': '少',
      'heat.more': '多',
      'heat.cell': '{date} · {tokens} · {sessions} 个会话 · {turns} 轮',
      'trend.cell': '{date} · {tokens} · {turns} 轮',
      'heat.month': '{month}月',
      'trend.title': '每日 Token 趋势',
      'trend.range7': '近 7 日',
      'trend.range30': '近 30 日',
      'trend.total': '区间合计 {tokens} tok',
      'model.title': '模型用量',
      'model.count': '{count} 个模型 · 缓存命中 {percent}',
      'model.sessions': '{count} 个会话',
      'sessions.title': '会话用量',
      'sessions.meta': '共 {total} 个会话 · 显示前 {shown}',
      'sessions.session': '会话',
      'sessions.model': '模型',
      'sessions.tokens': 'Token',
      'sessions.time': '最后活跃',
      empty: '当前区间暂无可展示的用量数据。',
      today: '今天',
      yesterday: '昨天',
      'number.groupSeparator': ',',
      'number.thousand': '{value}k',
      'number.million': '{value}M',
      'number.billion': '{value}B',
    };

    /** English dictionary; every key of `zh` appears here too. */
    const en = {
      panel: 'Usage',
      'panel.chip': 'Local usage',
      subtitle: "Provider-reported usage across every session on this machine; each session's usage is attributed to its last active day.",
      refresh: 'Refresh',
      updated: 'Updated {time}',
      'state.loading': 'Reading usage…',
      'state.error': 'Could not read usage: {message}',
      'state.empty': 'Nothing to show yet: no session usage is stored on this machine.',
      'card.total': 'Total tokens',
      'card.peak': 'Peak tokens',
      'card.sessions': 'Sessions with usage',
      'card.current': 'Current streak',
      'card.longest': 'Longest streak',
      'card.hint.peak': 'single session',
      'card.hint.sessions': '{count} checkpoints',
      'card.hint.days': 'days',
      'card.hint.mix': 'input {input} · cached {cacheRead} · output {output}',
      'heat.title': 'Token activity',
      'heat.daily': 'Daily',
      'heat.weekly': 'Weekly',
      'heat.cumulative': 'Cumulative',
      'heat.less': 'Less',
      'heat.more': 'More',
      'heat.cell': '{date} · {tokens} · {sessions} sessions · {turns} turns',
      'trend.cell': '{date} · {tokens} · {turns} turns',
      'heat.month': '{month}',
      'trend.title': 'Daily token trend',
      'trend.range7': 'Last 7 days',
      'trend.range30': 'Last 30 days',
      'trend.total': '{tokens} tok in range',
      'model.title': 'Model usage',
      'model.count': '{count} models · cache hit {percent}',
      'model.sessions': '{count} sessions',
      'sessions.title': 'Session usage',
      'sessions.meta': '{total} sessions · top {shown}',
      'sessions.session': 'Session',
      'sessions.model': 'Model',
      'sessions.tokens': 'Tokens',
      'sessions.time': 'Last active',
      empty: 'No usage data to show in this range.',
      today: 'Today',
      yesterday: 'Yesterday',
      'number.groupSeparator': ',',
      'number.thousand': '{value}k',
      'number.million': '{value}M',
      'number.billion': '{value}B',
    };

    // ------------------------------------------------------------ formatting

    /**
     * Local midnight of one instant.
     * @param ts - epoch milliseconds.
     * @returns epoch milliseconds of that local day's 00:00.
     */
    function startOfDay(ts) {
      const date = new Date(ts);
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    }

    /**
     * Stable local day key.
     * @param ts - epoch milliseconds.
     * @returns `YYYY-MM-DD` in local time.
     */
    function dayKeyOf(ts) {
      const date = new Date(ts);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    /**
     * Group an integer with the locale's separator.
     * @param value - count.
     * @param t - locale seat.
     * @returns grouped digits.
     */
    function grouped(value, t) {
      const digits = String(Math.max(0, Math.round(value)));
      return digits.replace(/\B(?=(\d{3})+(?!\d))/g, t('number.groupSeparator'));
    }

    /**
     * Compact token count: 1.2k / 45.3M / 9.0B.
     * @param value - token count.
     * @param t - locale seat.
     * @returns compact display string.
     */
    function compact(value, t) {
      const scaled = (candidate) => (candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10));
      if (value < 1e3) return String(Math.round(value));
      if (value < 1e6) return t('number.thousand', { value: scaled(value / 1e3) });
      if (value < 1e9) return t('number.million', { value: scaled(value / 1e6) });
      return t('number.billion', { value: scaled(value / 1e9) });
    }

    /**
     * Share of one value in a total.
     * @param part - numerator.
     * @param total - denominator.
     * @returns one-decimal percentage text, or an em dash at zero total.
     */
    function percent(part, total) {
      if (total <= 0) return '—';
      const share = (part / total) * 100;
      if (share > 0 && share < 0.1) return '<0.1%';
      return `${share >= 10 ? Math.round(share) : Math.round(share * 10) / 10}%`;
    }

    /**
     * Short clock/day label for one instant.
     * @param ts - epoch milliseconds.
     * @param now - current epoch milliseconds.
     * @param t - locale seat.
     * @returns `HH:mm` today, `Yesterday HH:mm`, or `MM-DD`.
     */
    function whenLabel(ts, now, t) {
      if (!(ts > 0)) return '—';
      const date = new Date(ts);
      const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
      if (startOfDay(ts) === startOfDay(now)) return `${t('today')} ${hm}`;
      if (startOfDay(ts) === startOfDay(now) - DAY_MS) return `${t('yesterday')} ${hm}`;
      return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${hm}`;
    }

    // -------------------------------------------------------------- charting

    /**
     * Index the payload's sparse daily rows.
     * @param daily - `[{ date, tokens, sessions }]` from the summary.
     * @returns day key → bucket map.
     */
    function indexDaily(daily) {
      const map = new Map();
      for (const row of Array.isArray(daily) ? daily : []) {
        if (typeof row?.date !== 'string') continue;
        map.set(row.date, { tokens: row.tokens ?? 0, sessions: row.sessions ?? 0, turns: row.turns ?? 0 });
      }
      return map;
    }

    /**
     * Build the rolling-year heatmap columns.
     * @param byDay - day buckets keyed by `YYYY-MM-DD`.
     * @param mode - `daily`, `weekly`, or `cumulative`.
     * @param now - current epoch milliseconds.
     * @returns week columns of cells plus the per-mode maximum.
     */
    function buildHeatmap(byDay, mode, now) {
      const today = startOfDay(now);
      const first = today - (HEATMAP_WEEKS * 7 - 1) * DAY_MS;
      const align = (new Date(first).getDay() + 6) % 7;
      const gridStart = first - align * DAY_MS;
      const days = [];
      let runningTokens = 0;
      let runningSessions = 0;
      let runningTurns = 0;
      for (let ts = gridStart; ts <= today; ts += DAY_MS) {
        const bucket = byDay.get(dayKeyOf(ts));
        const tokens = bucket?.tokens ?? 0;
        const sessions = bucket?.sessions ?? 0;
        const turns = bucket?.turns ?? 0;
        runningTokens += tokens;
        runningSessions += sessions;
        runningTurns += turns;
        days.push({
          ts,
          tokens,
          sessions,
          turns,
          cumulativeTokens: runningTokens,
          cumulativeSessions: runningSessions,
          cumulativeTurns: runningTurns,
        });
      }

      const cells = [];
      for (let index = 0; index < days.length; index += 7) {
        const week = days.slice(index, index + 7);
        const weekTokens = week.reduce((sum, day) => sum + day.tokens, 0);
        const weekSessions = week.reduce((sum, day) => sum + day.sessions, 0);
        const weekTurns = week.reduce((sum, day) => sum + day.turns, 0);
        for (const day of week) {
          if (mode === 'weekly') cells.push({ ts: day.ts, value: weekTokens, sessions: weekSessions, turns: weekTurns });
          else if (mode === 'cumulative') cells.push({ ts: day.ts, value: day.cumulativeTokens, sessions: day.cumulativeSessions, turns: day.cumulativeTurns });
          else cells.push({ ts: day.ts, value: day.tokens, sessions: day.sessions, turns: day.turns });
        }
      }

      const max = cells.reduce((best, cell) => Math.max(best, cell.value), 0);
      const weeks = [];
      for (let index = 0; index < cells.length; index += 7) {
        weeks.push(cells.slice(index, index + 7).map((cell) => ({
          ...cell,
          level: cell.value <= 0 || max <= 0 ? 0 : Math.max(1, Math.ceil((cell.value / max) * HEAT_TINTS.length)),
        })));
      }
      return { weeks, max };
    }

    /**
     * One rolling window of daily totals ending today.
     * @param byDay - day buckets keyed by `YYYY-MM-DD`.
     * @param range - number of days.
     * @param now - current epoch milliseconds.
     * @returns per-day points and the window maximum.
     */
    function buildTrend(byDay, range, now) {
      const today = startOfDay(now);
      const points = [];
      let max = 0;
      let total = 0;
      for (let offset = range - 1; offset >= 0; offset -= 1) {
        const ts = today - offset * DAY_MS;
        const bucket = byDay.get(dayKeyOf(ts));
        const tokens = bucket?.tokens ?? 0;
        max = Math.max(max, tokens);
        total += tokens;
        points.push({ ts, tokens, turns: bucket?.turns ?? 0 });
      }
      return { points, max, total };
    }

    // ------------------------------------------------------------ components

    /**
     * One headline figure.
     * @param props.label - figure name.
     * @param props.value - display value.
     * @param props.hint - optional secondary line.
     * @param props.title - optional tooltip.
     */
    function StatCard({ label, value, hint, title }) {
      return h(
        'div',
        { className: 'us-card', title },
        h('span', { className: 'us-cardValue' }, value),
        h('span', { className: 'us-cardLabel' }, label),
        hint !== undefined ? h('span', { className: 'us-cardHint' }, hint) : null,
      );
    }

    /**
     * A pill segmented control.
     * @param props.options - `[{ id, label }]`.
     * @param props.value - selected id.
     * @param props.onChange - selection callback.
     * @param props.ariaLabel - accessible group name.
     */
    function Segmented({ options, value, onChange, ariaLabel }) {
      return h(
        'div',
        { className: 'us-seg', role: 'group', 'aria-label': ariaLabel },
        options.map((option) => h(
          'button',
          {
            key: option.id,
            type: 'button',
            className: 'us-segBtn',
            'aria-pressed': value === option.id,
            onClick: () => onChange(option.id),
          },
          option.label,
        )),
      );
    }

    /**
     * Calendar heatmap of token activity.
     * @param props.heatmap - result of `buildHeatmap`.
     * @param props.t - locale seat.
     */
    function Heatmap({ heatmap, t }) {
      if (heatmap.max <= 0) return h('div', { className: 'us-empty' }, t('empty'));
      const columns = `repeat(${heatmap.weeks.length}, 11px)`;
      return h(
        'div',
        { className: 'us-heat' },
        h(
          'div',
          { className: 'us-heatScale' },
          h('span', null, t('heat.less')),
          h('span', { className: 'us-heatScaleBar' },
            h('span', { className: 'us-heatCell' }),
            HEAT_TINTS.map((tint) => h('span', { key: tint, className: 'us-heatCell', style: { background: tint } }))),
          h('span', null, t('heat.more')),
        ),
        h(
          'div',
          { className: 'us-heatBody' },
          h('div', { className: 'us-heatMonths', style: { gridTemplateColumns: columns } },
            heatmap.weeks.map((cells, index) => {
              const firstOfMonth = cells.find((cell) => new Date(cell.ts).getDate() === 1);
              return h('span', { key: index, className: 'us-heatMonth' },
                firstOfMonth === undefined ? '' : t('heat.month', { month: new Date(firstOfMonth.ts).getMonth() + 1 }));
            })),
          h('div', { className: 'us-heatGrid', style: { gridTemplateColumns: columns } },
            heatmap.weeks.map((cells, index) => h(
              'div',
              { key: index, className: 'us-heatWeek' },
              cells.map((cell) => h('span', {
                key: cell.ts,
                className: 'us-heatCell',
                style: cell.level === 0 ? undefined : { background: HEAT_TINTS[cell.level - 1] },
                title: t('heat.cell', {
                  date: dayKeyOf(cell.ts),
                  tokens: `${compact(cell.value, t)} tok`,
                  sessions: cell.sessions,
                  turns: cell.turns,
                }),
              })),
            )),
          ),
        ),
      );
    }

    /**
     * Daily bar chart for the selected window.
     * @param props.trend - result of `buildTrend`.
     * @param props.range - window length in days.
     * @param props.t - locale seat.
     */
    function TrendChart({ trend, range, t }) {
      if (trend.max <= 0) return h('div', { className: 'us-empty' }, t('empty'));
      const labelEvery = range > 10 ? 5 : 1;
      return h(
        'div',
        { className: 'us-trend' },
        trend.points.map((point, index) => {
          const date = new Date(point.ts);
          const showLabel = (range - 1 - index) % labelEvery === 0;
          return h(
            'div',
            {
              key: point.ts,
              className: 'us-trendCol',
              title: t('trend.cell', {
                date: dayKeyOf(point.ts),
                tokens: `${compact(point.tokens, t)} tok`,
                turns: point.turns,
              }),
            },
            h(
              'div',
              { className: 'us-trendTrack' },
              h('span', {
                className: point.tokens > 0 ? 'us-bar' : 'us-bar us-barEmpty',
                style: { height: point.tokens > 0 ? `${Math.max(2, (point.tokens / trend.max) * 100)}%` : '2%' },
              }),
            ),
            h('span', { className: 'us-trendLabel' },
              showLabel ? `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : ''),
          );
        }),
      );
    }

    /**
     * Per-model usage bars.
     * @param props.models - model buckets sorted by tokens.
     * @param props.total - all-session token total.
     * @param props.t - locale seat.
     */
    function ModelUsage({ models, total, t }) {
      if (models.length === 0) return h('div', { className: 'us-empty' }, t('empty'));
      const max = models[0].tokens;
      return h(
        'div',
        { className: 'us-models' },
        models.map((model) => h(
          'div',
          { key: model.key === '' ? 'unknown' : model.key, className: 'us-model' },
          h('span', { className: 'us-modelName', title: model.key }, model.key === '' ? '—' : model.key),
          h('span', { className: 'us-modelTrack' },
            h('span', { className: 'us-modelFill', style: { width: `${Math.max(1, (model.tokens / max) * 100)}%` } })),
          h('span', { className: 'us-modelTokens' }, `${compact(model.tokens, t)} tok`),
          h('span', { className: 'us-modelShare' }, percent(model.tokens, total)),
          h('span', { className: 'us-modelCount' }, t('model.sessions', { count: model.sessions })),
        )),
      );
    }

    /**
     * Session ranking with a jump-to-session action.
     * @param props.sessions - sessions ordered by tokens.
     * @param props.openSession - navigation callback, or undefined.
     * @param props.now - current epoch ms.
     * @param props.t - locale seat.
     */
    function SessionTable({ sessions, openSession, now, t }) {
      if (sessions.length === 0) return h('div', { className: 'us-empty' }, t('empty'));
      return h(
        'div',
        { className: 'us-rows' },
        sessions.map((session) => h(
          'button',
          {
            key: session.id,
            type: 'button',
            className: 'us-row',
            onClick: openSession === undefined ? undefined : () => openSession(session.id),
            title: session.title === '' ? session.cwd : session.title,
          },
          h('span', { className: 'us-rowTitle' }, session.title === '' ? (session.cwd || session.id) : session.title),
          h('span', { className: 'us-rowMeta' }, session.model === '' ? '—' : `${session.provider}/${session.model}`),
          h('span', { className: 'us-rowTokens' }, `${compact(session.tokens, t)} tok`),
          h('span', { className: 'us-rowMeta' }, whenLabel(session.lastActiveAt, now, t)),
        )),
      );
    }

    /** Component-local styles, rendered as an element so unmounting removes them. */
    const CSS = [
      '.us-page{height:100%;overflow-y:auto;padding:26px 32px 44px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}',
      '.us-inner{max-width:1060px;margin:0 auto;display:flex;flex-direction:column;gap:16px}',
      '.us-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.us-title{margin:0;font-size:22px;line-height:30px;font-weight:600}',
      '.us-chip{border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1)}',
      '.us-headRight{margin-left:auto;display:inline-flex;align-items:center;gap:10px}',
      '.us-updated{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption)}',
      '.us-refresh{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}',
      '.us-refresh:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.us-refresh:disabled{opacity:.5;cursor:default}',
      '.us-refresh:focus-visible{outline:2px solid var(--dsw-static-blue-500);outline-offset:1px}',
      '.us-sub{margin:-8px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.us-cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}',
      '@media (max-width:1180px){.us-cards{grid-template-columns:repeat(3,minmax(0,1fr))}}',
      '.us-card{box-sizing:border-box;display:flex;flex-direction:column;gap:4px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1)}',
      '.us-cardValue{font-size:20px;line-height:26px;font-weight:600;font-variant-numeric:tabular-nums}',
      '.us-cardLabel{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.us-cardHint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption)}',
      '.us-panel{box-sizing:border-box;padding:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1)}',
      '.us-panelHead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap}',
      '.us-panelTitle{font-size:14px;line-height:22px;font-weight:500}',
      '.us-panelMeta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.us-seg{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-base)}',
      '.us-segBtn{padding:2px 10px;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}',
      '.us-segBtn:hover{color:var(--dsw-alias-label-primary)}',
      '.us-segBtn[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.us-segBtn:focus-visible{outline:2px solid var(--dsw-static-blue-500);outline-offset:1px}',
      '.us-heat{display:flex;flex-direction:column;gap:8px}',
      '.us-heatBody{overflow-x:auto;padding-bottom:2px}',
      '.us-heatMonths{display:grid;gap:3px;margin-bottom:4px;width:max-content}',
      '.us-heatMonth{font-size:10px;line-height:12px;color:var(--dsw-alias-label-caption);white-space:nowrap}',
      '.us-heatGrid{display:grid;gap:3px;width:max-content}',
      '.us-heatWeek{display:grid;grid-template-rows:repeat(7,11px);gap:3px}',
      '.us-heatCell{display:block;width:11px;height:11px;border-radius:2px;background:var(--dsw-alias-border-l2)}',
      '.us-heatScale{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-caption)}',
      '.us-heatScaleBar{display:inline-flex;gap:3px}',
      '.us-trend{display:flex;align-items:flex-end;gap:4px;height:150px}',
      '.us-trendCol{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:6px;height:100%}',
      '.us-trendTrack{display:flex;align-items:flex-end;justify-content:center;width:100%;height:100%;min-height:0}',
      '.us-bar{display:block;width:100%;max-width:26px;border-radius:3px 3px 0 0;background:var(--dsw-static-blue-500)}',
      '.us-barEmpty{background:var(--dsw-alias-border-l2)}',
      '.us-trendLabel{font-size:10px;line-height:12px;color:var(--dsw-alias-label-caption);white-space:nowrap}',
      '.us-models{display:flex;flex-direction:column;gap:10px}',
      '.us-model{display:grid;grid-template-columns:minmax(120px,1fr) minmax(80px,1.4fr) auto 48px auto;gap:4px 12px;align-items:center;font-size:13px;line-height:20px}',
      '.us-modelName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.us-modelTrack{overflow:hidden;height:6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover)}',
      '.us-modelFill{display:block;height:100%;border-radius:999px;background:var(--dsw-static-blue-500)}',
      '.us-modelTokens{font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.us-modelShare{font-variant-numeric:tabular-nums;text-align:right;color:var(--dsw-alias-label-secondary)}',
      '.us-modelCount{font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.us-rows{display:flex;flex-direction:column;max-height:340px;overflow-y:auto;margin:0 -8px}',
      '.us-row{display:grid;grid-template-columns:minmax(0,1fr) 180px auto 120px;gap:12px;align-items:center;width:100%;padding:7px 8px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;font:inherit;color:inherit;text-align:left;cursor:pointer}',
      '.us-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.us-rowHead{cursor:default;padding-top:0;padding-bottom:4px;border-bottom:1px solid var(--dsw-alias-border-l2);border-radius:0;margin-bottom:2px}',
      '.us-rowHead:hover{background:transparent}',
      '.us-rowHead .us-rowTitle,.us-rowHead .us-rowMeta,.us-rowHead .us-rowTokens{font-size:11px;color:var(--dsw-alias-label-caption)}',
      '.us-row:focus-visible{outline:2px solid var(--dsw-static-blue-500);outline-offset:-2px}',
      '.us-rowTitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:20px}',
      '.us-rowMeta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.us-rowTokens{font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;text-align:right}',
      '.us-empty{padding:28px;border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary)}',
    ].join('\n');

    /**
     * The statistics page.
     * @param props.t - locale seat.
     * @param props.openSession - navigation callback for a session row.
     */
    function UsageStatsPage({ t, openSession }) {
      const [state, setState] = React.useState({ phase: 'loading', data: null });
      const [heatMode, setHeatMode] = React.useState('daily');
      const [range, setRange] = React.useState(30);

      const load = React.useCallback(() => {
        let cancelled = false;
        setState((previous) => ({ phase: 'loading', data: previous.data }));
        fetch(SUMMARY_URL, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then((data) => {
            if (!cancelled) setState({ phase: 'ready', data });
          })
          .catch((error) => {
            if (!cancelled) setState({ phase: 'error', data: null, message: String(error?.message ?? error) });
          });
        return () => {
          cancelled = true;
        };
      }, []);

      React.useEffect(() => load(), [load]);

      const now = Date.now();
      const data = state.data;
      const byDay = React.useMemo(() => indexDaily(data?.daily), [data]);
      const heatmap = React.useMemo(() => buildHeatmap(byDay, heatMode, now), [byDay, heatMode, now]);
      const trend = React.useMemo(() => buildTrend(byDay, range, now), [byDay, range, now]);

      const head = h(
        'div',
        { className: 'us-head' },
        h('h1', { className: 'us-title' }, t('panel')),
        h('span', { className: 'us-chip' }, t('panel.chip')),
        h('span', { className: 'us-headRight' },
          data !== null && h('span', { className: 'us-updated' },
            t('updated', { time: whenLabel(data.generatedAt, now, t) })),
          h('button', {
            type: 'button',
            className: 'us-refresh',
            disabled: state.phase === 'loading',
            onClick: load,
          }, t('refresh'))),
      );

      if (data === null) {
        return h(
          'div',
          { className: 'us-page' },
          h('style', null, CSS),
          h('div', { className: 'us-inner' },
            head,
            h('div', { className: 'us-empty' },
              state.phase === 'error' ? t('state.error', { message: state.message ?? '' }) : t('state.loading'))),
        );
      }

      if (data.available !== true || data.counts?.sessions === 0) {
        return h(
          'div',
          { className: 'us-page' },
          h('style', null, CSS),
          h('div', { className: 'us-inner' }, head, h('div', { className: 'us-empty' }, t('state.empty'))),
        );
      }

      const totals = data.totals ?? { tokens: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
      const streak = data.streak ?? { current: 0, longest: 0 };
      const peak = data.peak ?? null;

      return h(
        'div',
        { className: 'us-page' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'us-inner' },
          head,
          h('p', { className: 'us-sub' }, t('subtitle')),
          h(
            'div',
            { className: 'us-cards' },
            h(StatCard, {
              label: t('card.total'),
              value: compact(totals.tokens, t),
              hint: t('card.hint.mix', {
                input: percent(totals.input, totals.tokens),
                cacheRead: percent(totals.cacheRead, totals.tokens),
                output: percent(totals.output, totals.tokens),
              }),
              title: `${grouped(totals.tokens, t)} tok`,
            }),
            h(StatCard, {
              label: t('card.peak'),
              value: peak === null ? '—' : compact(peak.tokens, t),
              hint: peak === null ? undefined : `${compact(peak.tokens, t)} tok`,
              title: peak === null ? undefined : (peak.title || peak.cwd || peak.sessionId),
            }),
            h(StatCard, {
              label: t('card.sessions'),
              value: String(data.counts?.sessions ?? 0),
              hint: t('card.hint.sessions', { count: data.counts?.checkpoints ?? 0 }),
            }),
            h(StatCard, { label: t('card.current'), value: String(streak.current), hint: t('card.hint.days') }),
            h(StatCard, { label: t('card.longest'), value: String(streak.longest), hint: t('card.hint.days') }),
          ),
          h(
            'section',
            { className: 'us-panel' },
            h('div', { className: 'us-panelHead' },
              h('span', { className: 'us-panelTitle' }, t('heat.title')),
              h(Segmented, {
                ariaLabel: t('heat.title'),
                value: heatMode,
                onChange: setHeatMode,
                options: [
                  { id: 'daily', label: t('heat.daily') },
                  { id: 'weekly', label: t('heat.weekly') },
                  { id: 'cumulative', label: t('heat.cumulative') },
                ],
              })),
            h(Heatmap, { heatmap, t }),
          ),
          h(
            'section',
            { className: 'us-panel' },
            h('div', { className: 'us-panelHead' },
              h('span', { className: 'us-panelTitle' }, t('trend.title')),
              h('span', { className: 'us-panelMeta' }, t('trend.total', { tokens: compact(trend.total, t) })),
              h(Segmented, {
                ariaLabel: t('trend.title'),
                value: String(range),
                onChange: (next) => setRange(Number(next)),
                options: [
                  { id: '7', label: t('trend.range7') },
                  { id: '30', label: t('trend.range30') },
                ],
              })),
            h(TrendChart, { trend, range, t }),
          ),
          h(
            'section',
            { className: 'us-panel' },
            h('div', { className: 'us-panelHead' },
              h('span', { className: 'us-panelTitle' }, t('model.title')),
              h('span', { className: 'us-panelMeta' },
                t('model.count', {
                  count: data.models?.length ?? 0,
                  percent: percent(totals.cacheRead, totals.input + totals.cacheRead),
                }))),
            h(ModelUsage, { models: data.models ?? [], total: totals.tokens, t }),
          ),
          h(
            'section',
            { className: 'us-panel' },
            h('div', { className: 'us-panelHead' },
              h('span', { className: 'us-panelTitle' }, t('sessions.title')),
              h('span', { className: 'us-panelMeta' },
                t('sessions.meta', {
                  total: data.counts?.sessions ?? 0,
                  shown: data.sessions?.length ?? 0,
                }))),
            h('div', { className: 'us-row us-rowHead', 'aria-hidden': true },
              h('span', { className: 'us-rowTitle' }, t('sessions.session')),
              h('span', { className: 'us-rowMeta' }, t('sessions.model')),
              h('span', { className: 'us-rowTokens' }, t('sessions.tokens')),
              h('span', { className: 'us-rowMeta' }, t('sessions.time'))),
            h(SessionTable, { sessions: data.sessions ?? [], openSession, now, t }),
          ),
        ),
      );
    }

    /**
     * Sidebar glyph for the panel row.
     * @param props.size - icon edge length in px.
     */
    function PanelIcon({ size }) {
      const edge = size ?? 16;
      return h(
        'svg',
        { width: edge, height: edge, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': true, focusable: false },
        h('path', {
          d: 'M3.5 16.5V11.5M8 16.5V7.5M12.5 16.5V4.5M17 16.5V9.5',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
        }),
      );
    }

    return {
      inject: ['slots', 'locale', 'uiWorkspace'],
      /**
       * Register the panel, its sidebar row and the locale dictionaries.
       * @param ctx - Client plugin context.
       */
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'usage-stats: dictionaries');
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => ({
            openSession: (sessionId) => {
              ctx.uiWorkspace.openSession(sessionId);
            },
          }),
        }, UsageStatsPage));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 11,
          locale: NS,
          label: () => t('panel'),
        }, PanelIcon));
      },
    };
  },
});
