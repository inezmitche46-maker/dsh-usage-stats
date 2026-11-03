/**
 * Client half of the session token statistics bundle.
 *
 * Registers one entry in `conversation.composer.dock`: a persistent pill that
 * shows the whole-session token total and opens a panel with the provider
 * buckets (uncached input, cache read, cache write, output) plus the cache-hit
 * share. Every number comes from the `tokenUsage` session projection that
 * `@deepseek-ai/dsh-token-meter` already registers, so this bundle folds no
 * session events and asks the Host for nothing.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-token-stats',
  factory(require) {
    const React = require('react');
    const { createPortal } = require('react-dom');
    const h = React.createElement;

    /** Locale namespace owned by this bundle. */
    const NS = 'session-token-stats';

    /**
     * The shipped `usage` pill reports the same whole-session total, so this
     * plugin hides it and becomes the single, always-visible entry point; the
     * cache-hit share that pill used to show lives in this panel. Set to false
     * to keep both pills side by side.
     */
    const HIDE_BUILTIN_USAGE_PILL = true;

    /** Simplified Chinese dictionary and key-set source of truth. */
    const zh = {
      'pill.label': 'Token 统计',
      'pill.aria': '本会话 Token 统计：{total}',
      'panel.title': '本会话 Token 统计',
      'panel.subtitle': '缓存命中 {percent}',
      'panel.subtitleEmpty': '本会话还没有产生 token 用量',
      'panel.hint': '数据来自提供方上报的用量，覆盖整个会话，包含已被压缩的历史。',
      'row.input': '输入（未缓存）',
      'row.cacheRead': '缓存读取',
      'row.cacheWrite': '缓存写入',
      'row.output': '输出',
      'row.total': '合计',
      'unit.count': '{count} tok',
      'number.groupSeparator': ',',
      'number.thousand': '{value}k',
      'number.million': '{value}M',
    };

    /** English dictionary; every key of `zh` must appear here too. */
    const en = {
      'pill.label': 'Token usage',
      'pill.aria': 'Session token usage: {total}',
      'panel.title': 'Session token usage',
      'panel.subtitle': 'Cache hit {percent}',
      'panel.subtitleEmpty': 'No token usage in this session yet',
      'panel.hint': 'Provider-reported usage for the whole session, including compacted history.',
      'row.input': 'Uncached input',
      'row.cacheRead': 'Cached input',
      'row.cacheWrite': 'Cache write',
      'row.output': 'Output',
      'row.total': 'Total',
      'unit.count': '{count} tok',
      'number.groupSeparator': ',',
      'number.thousand': '{value}k',
      'number.million': '{value}M',
    };

    /** Bucket tints: two theme tokens plus the neutral-violet the Host uses for tools. */
    const TINT = {
      input: 'var(--dsw-static-blue-450)',
      cacheRead: 'var(--dsw-alias-state-success-primary)',
      cacheWrite: '#a78bfa',
      output: 'var(--dsw-alias-state-warn-primary)',
    };

    /** Viewport margin kept between the panel and the window edge. */
    const PANEL_MARGIN = 12;
    /** Distance between the trigger and the panel. */
    const PANEL_GAP = 8;
    /** Hidden first-pass style so the panel can be measured before placement. */
    const MEASURE_STYLE = { left: 0, top: 0, visibility: 'hidden' };

    /** Bar-chart glyph shared by the trigger and the panel heading. */
    function Icon() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          fill: 'none',
          'aria-hidden': true,
          focusable: false,
        },
        h('path', {
          d: 'M2.75 13.25V9.5M6.75 13.25V6.5M10.75 13.25V3.75M14 13.25V8',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
        }),
      );
    }

    /**
     * Group a token count with the locale's separator.
     * @param value - token count.
     * @param t - locale seat of this bundle.
     * @returns exact digits, grouped in threes.
     */
    function groupedTokens(value, t) {
      const digits = String(Math.max(0, Math.round(value)));
      return digits.replace(/\B(?=(\d{3})+(?!\d))/g, t('number.groupSeparator'));
    }

    /**
     * Compact a token count for the pill: 1.2k under a million, else 1.2M.
     * @param value - token count.
     * @param t - locale seat of this bundle.
     * @returns compact display string.
     */
    function compactTokens(value, t) {
      if (value < 1e3) return String(Math.round(value));
      const scaled = (candidate) => (candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10));
      if (value < 1e6) return t('number.thousand', { value: scaled(value / 1e3) });
      return t('number.million', { value: scaled(value / 1e6) });
    }

    /**
     * Share of one bucket in the session total.
     * @param value - bucket token count.
     * @param total - session token total.
     * @returns percentage text, or an em dash when nothing is billed yet.
     */
    function shareText(value, total) {
      if (total <= 0) return '—';
      const share = (value / total) * 100;
      if (share > 0 && share < 0.1) return '<0.1%';
      return `${share >= 10 ? Math.round(share) : Math.round(share * 10) / 10}%`;
    }

    /**
     * Format an already-computed percentage without trailing noise.
     * @param value - percentage number.
     * @returns percentage text.
     */
    function percentText(value) {
      return `${Math.round(value * 10) / 10}%`;
    }

    /** Component-local styles, rendered as an element so unmounting removes them. */
    const CSS = [
      '.tks-root{min-width:0;display:inline-flex;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}',
      '.tks-pill{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:1px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;cursor:pointer}',
      '.tks-pill:hover,.tks-pill[aria-expanded="true"]{border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}',
      '.tks-pill svg{flex:none;width:14px;height:14px}',
      '.tks-label{min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-tertiary)}',
      '.tks-value{color:var(--dsw-alias-label-primary);font-weight:500}',
      '.tks-panel{position:fixed;z-index:1100;box-sizing:border-box;width:max-content;min-width:min(300px,100vw - 24px);max-width:min(360px,100vw - 24px);padding:16px;border:0;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;cursor:default}',
      '.tks-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;color:var(--dsw-alias-label-primary);font-weight:500}',
      '.tks-headLabel{display:inline-flex;align-items:center;gap:6px;min-width:0}',
      '.tks-headLabel svg{flex:none;width:14px;height:14px}',
      '.tks-headValue{font-variant-numeric:tabular-nums}',
      '.tks-sub{margin-top:2px;color:var(--dsw-alias-label-tertiary)}',
      '.tks-bar{display:flex;gap:1px;height:6px;margin:10px 0 12px;overflow:hidden;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover)}',
      '.tks-seg{flex:none;min-width:2px;height:100%;background:var(--tks-tint)}',
      '.tks-rows{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px 12px;margin:0;color:var(--dsw-alias-label-tertiary)}',
      '.tks-rows dt,.tks-rows dd{min-width:0;margin:0}',
      '.tks-rows dt{display:flex;align-items:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tks-rows dd{text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}',
      '.tks-rows .tks-share{min-width:44px;color:var(--dsw-alias-label-tertiary)}',
      '.tks-swatch{flex:none;width:8px;height:8px;margin-right:6px;border-radius:2px;background:var(--tks-tint)}',
      '.tks-rule{margin:8px 0;border-top:1px solid var(--dsw-alias-border-l2)}',
      '.tks-total dt{color:var(--dsw-alias-label-primary);font-weight:500}',
      '.tks-hint{margin:10px 0 0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
      HIDE_BUILTIN_USAGE_PILL ? '[data-composer-stat="usage"]{display:none !important}' : '',
    ].filter((rule) => rule.length > 0).join('\n');

    /**
     * Anchor the panel above the trigger, clamped to the viewport, and fall
     * back to below when there is no room.
     * @param open - whether the panel is mounted.
     * @param triggerRef - pill button ref.
     * @param panelRef - portaled panel ref.
     * @returns current placement and the re-measure callback.
     */
    function useAnchoredPanel(open, triggerRef, panelRef) {
      const [placement, setPlacement] = React.useState(null);
      const measure = React.useCallback(() => {
        const trigger = triggerRef.current;
        if (trigger === null) return;
        const rect = trigger.getBoundingClientRect();
        const width = panelRef.current?.offsetWidth ?? 320;
        const height = panelRef.current?.offsetHeight ?? 240;
        const maxLeft = Math.max(PANEL_MARGIN, window.innerWidth - width - PANEL_MARGIN);
        const left = Math.min(Math.max(PANEL_MARGIN, rect.left), maxLeft);
        const above = rect.top - PANEL_GAP - height;
        const top = above >= PANEL_MARGIN
          ? above
          : Math.min(window.innerHeight - height - PANEL_MARGIN, rect.bottom + PANEL_GAP);
        setPlacement({ left, top: Math.max(PANEL_MARGIN, top) });
      }, [panelRef, triggerRef]);
      React.useLayoutEffect(() => {
        if (!open) {
          setPlacement(null);
          return;
        }
        measure();
      }, [measure, open]);
      return { measure, placement };
    }

    /**
     * Composer pill plus its detail panel.
     * @param props.useProjection - framework selector hook over session projections.
     * @param props.t - locale seat of this bundle.
     */
    function TokenStatsPill({ useProjection, t }) {
      const useTokenUsage = React.useMemo(
        () => (typeof useProjection === 'function' ? useProjection : () => undefined),
        [useProjection],
      );
      const usage = useTokenUsage('tokenUsage');
      const [open, setOpen] = React.useState(false);
      const rootRef = React.useRef(null);
      const triggerRef = React.useRef(null);
      const panelRef = React.useRef(null);
      const { measure, placement } = useAnchoredPanel(open, triggerRef, panelRef);

      React.useEffect(() => {
        if (!open) return;
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        const onPointerDown = (event) => {
          const target = event.target;
          if (!(target instanceof Node)) return;
          if (rootRef.current?.contains(target) === true) return;
          if (panelRef.current?.contains(target) === true) return;
          setOpen(false);
        };
        const onReflow = () => measure();
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('resize', onReflow);
        window.addEventListener('scroll', onReflow, true);
        return () => {
          document.removeEventListener('keydown', onKeyDown);
          document.removeEventListener('pointerdown', onPointerDown, true);
          window.removeEventListener('resize', onReflow);
          window.removeEventListener('scroll', onReflow, true);
        };
      }, [measure, open]);

      if (usage === undefined) return null;

      const buckets = [
        { key: 'input', label: t('row.input'), value: usage.uncachedInputTokens },
        { key: 'cacheRead', label: t('row.cacheRead'), value: usage.cacheReadTokens },
        { key: 'cacheWrite', label: t('row.cacheWrite'), value: usage.cacheWriteTokens },
        { key: 'output', label: t('row.output'), value: usage.outputTokens },
      ];
      const total = buckets.reduce((sum, bucket) => sum + bucket.value, 0);
      const prompt = usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
      const cacheHit = prompt > 0 ? (usage.cacheReadTokens / prompt) * 100 : null;
      const totalText = t('unit.count', { count: groupedTokens(total, t) });

      const panel = open
        ? createPortal(
          h(
            'div',
            {
              ref: panelRef,
              className: 'tks-panel',
              role: 'dialog',
              'aria-label': t('panel.title'),
              'data-session-token-stats': true,
              style: placement ?? MEASURE_STYLE,
            },
            h(
              'div',
              { className: 'tks-head' },
              h('span', { className: 'tks-headLabel' }, h(Icon), t('panel.title')),
              h('span', { className: 'tks-headValue' }, totalText),
            ),
            h('div', { className: 'tks-sub' }, cacheHit === null
              ? t('panel.subtitleEmpty')
              : t('panel.subtitle', { percent: percentText(cacheHit) })),
            h(
              'div',
              { className: 'tks-bar', 'aria-hidden': true },
              total === 0
                ? null
                : buckets
                  .filter((bucket) => bucket.value > 0)
                  .map((bucket) => h('span', {
                    key: bucket.key,
                    className: 'tks-seg',
                    style: {
                      '--tks-tint': TINT[bucket.key],
                      width: `${(bucket.value / total) * 100}%`,
                    },
                  })),
            ),
            h(
              'dl',
              { className: 'tks-rows' },
              buckets.flatMap((bucket) => [
                h(
                  'dt',
                  { key: `${bucket.key}-label` },
                  h('span', { className: 'tks-swatch', style: { '--tks-tint': TINT[bucket.key] } }),
                  bucket.label,
                ),
                h('dd', { key: `${bucket.key}-value` }, t('unit.count', { count: groupedTokens(bucket.value, t) })),
                h('dd', { key: `${bucket.key}-share`, className: 'tks-share' }, shareText(bucket.value, total)),
              ]),
            ),
            h('div', { className: 'tks-rule', 'aria-hidden': true }),
            h(
              'dl',
              { className: 'tks-rows tks-total' },
              h('dt', null, t('row.total')),
              h('dd', null, totalText),
              h('dd', { className: 'tks-share' }, total === 0 ? '—' : '100%'),
            ),
            h('p', { className: 'tks-hint' }, t('panel.hint')),
          ),
          document.body,
        )
        : null;

      return h(
        React.Fragment,
        null,
        h('style', { key: 'tks-style' }, CSS),
        h(
          'span',
          { ref: rootRef, className: 'tks-root', 'data-composer-stat': 'token-stats' },
          h(
            'button',
            {
              ref: triggerRef,
              type: 'button',
              className: 'tks-pill',
              'aria-haspopup': 'dialog',
              'aria-expanded': open,
              'aria-label': t('pill.aria', { total: totalText }),
              onClick: () => setOpen(!open),
            },
            h(Icon),
            h('span', { className: 'tks-label' }, t('pill.label')),
            h('span', { className: 'tks-value' }, compactTokens(total, t)),
          ),
          panel,
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      /**
       * Register the locale dictionaries and the composer dock entry.
       * @param ctx - Client plugin context.
       */
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-token-stats: dictionaries');
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'session-token-stats',
          order: 2,
          locale: NS,
        }, TokenStatsPill));
      },
    };
  },
});
