/* Client half of the MiniMax H3-Image plugin. Plain browser bundle, no build step. */
window.__ModuleLoader__.load({
  id: '@local/dsh-minimax-image',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const KEY = 'MINIMAX_API_KEY';
    const NS = 'minimax-image';
    let runtimeCtx;
    let t = (key) => key;

    const EN = {
      'settings.title': 'MiniMax Image',
      'settings.description': 'Generate images with MiniMax H3-Image.',
      'settings.keyLabel': 'MiniMax API key',
      'settings.keyPlaceholder': 'Paste an API key from the MiniMax console',
      'settings.save': 'Save key',
      'settings.saving': 'Saving...',
      'settings.loading': 'Loading credentials...',
      'settings.remove': 'Remove key',
      'settings.removing': 'Removing...',
      'settings.configured': 'Configured',
      'settings.notConfigured': 'Not configured',
      'settings.source.stored': 'stored in DSH credentials',
      'settings.source.environment': 'provided by the environment',
      'settings.source.unknown': 'configured',
      'settings.readonly': 'This credential is read-only in the current environment.',
      'settings.unavailable': 'Credential settings are unavailable in this client. Set MINIMAX_API_KEY in the environment instead.',
      'settings.saved': 'Key saved.',
      'settings.removed': 'Key removed.',
      'settings.empty': 'Enter a key before saving.',
      'settings.error': 'Could not update the key: ',
      'settings.endpoint': 'Endpoint: https://api.minimax.cn/v1 by default. Set MINIMAX_API_BASE to use another region or proxy.',
      'settings.privacy': 'The key is stored in the DSH credential store. It is never written to plugin config, session logs, or tool output.',
      'settings.billing': 'Image generation is billed by MiniMax. Every call generates n images, and failed or timed-out calls may still be billed.',
      'tool.title': 'MiniMax H3-Image',
      'tool.generating': 'Generating image...',
      'tool.waiting': 'Preparing request...',
      'tool.images': 'Generated images',
      'tool.failures': 'Failed images',
      'tool.noImage': 'The image is unavailable.',
      'tool.open': 'Open full size',
      'tool.requestId': 'request_id',
      'tool.revisedPrompt': 'Revised prompt',
      'tool.prompt': 'Prompt',
      'tool.error': 'Image generation failed',
      'tool.unavailable': 'Image preview is unavailable in this view.',
    };

    const ZH = {
      'settings.title': 'MiniMax 图像',
      'settings.description': '使用 MiniMax H3-Image 生成图片。',
      'settings.keyLabel': 'MiniMax API Key',
      'settings.keyPlaceholder': '粘贴 MiniMax 控制台创建的 API Key',
      'settings.save': '保存 Key',
      'settings.saving': '保存中...',
      'settings.loading': '正在读取凭证...',
      'settings.remove': '移除 Key',
      'settings.removing': '移除中...',
      'settings.configured': '已配置',
      'settings.notConfigured': '未配置',
      'settings.source.stored': '已存入 DSH 凭证库',
      'settings.source.environment': '来自环境变量',
      'settings.source.unknown': '已配置',
      'settings.readonly': '当前环境中的该凭证为只读。',
      'settings.unavailable': '当前客户端无法管理凭证。请改用环境变量 MINIMAX_API_KEY。',
      'settings.saved': 'Key 已保存。',
      'settings.removed': 'Key 已移除。',
      'settings.empty': '请先输入 Key。',
      'settings.error': '更新 Key 失败：',
      'settings.endpoint': '默认端点为 https://api.minimax.cn/v1；设置 MINIMAX_API_BASE 可切换区域或代理。',
      'settings.privacy': 'Key 保存在 DSH 凭证库中，不会写入插件配置、会话日志或工具输出。',
      'settings.billing': '图片由 MiniMax 计费。每次调用生成 n 张图；失败或超时的请求也可能已计费。',
      'tool.title': 'MiniMax H3-Image',
      'tool.generating': '正在生成图像...',
      'tool.waiting': '正在准备请求...',
      'tool.images': '生成的图像',
      'tool.failures': '失败的图像',
      'tool.noImage': '图片不可用。',
      'tool.open': '查看原图',
      'tool.requestId': 'request_id',
      'tool.revisedPrompt': '修订后的提示词',
      'tool.prompt': '提示词',
      'tool.error': '图像生成失败',
      'tool.unavailable': '当前视图无法预览图像。',
    };

    const styles = {
      section: {
        padding: '18px',
        display: 'grid',
        gap: '14px',
        maxWidth: '720px',
        color: 'var(--dsw-alias-text-primary, inherit)',
      },
      title: { margin: 0, fontSize: '18px', fontWeight: 600 },
      description: {
        margin: 0,
        fontSize: '13px',
        lineHeight: 1.6,
        color: 'var(--dsw-alias-text-secondary, #666)',
      },
      card: {
        padding: '14px',
        border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.25))',
        borderRadius: '10px',
        display: 'grid',
        gap: '10px',
        background: 'var(--dsw-alias-bg-layer-2, transparent)',
      },
      label: { fontSize: '13px', fontWeight: 600 },
      row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
      input: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '9px 10px',
        borderRadius: '7px',
        border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.3))',
        background: 'var(--dsw-alias-bg-layer-1, transparent)',
        color: 'inherit',
        fontSize: '13px',
      },
      button: {
        padding: '8px 14px',
        borderRadius: '7px',
        border: '1px solid transparent',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: 600,
        background: 'var(--dsw-alias-bg-accent, #2563eb)',
        color: 'var(--dsw-alias-text-on-accent, #fff)',
      },
      buttonSecondary: {
        padding: '8px 14px',
        borderRadius: '7px',
        cursor: 'pointer',
        fontSize: '13px',
        border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.35))',
        background: 'transparent',
        color: 'inherit',
      },
      status: { fontSize: '13px', display: 'flex', gap: '6px', alignItems: 'center' },
      dotOk: {
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: 'var(--dsw-alias-success, #16a34a)',
        display: 'inline-block',
      },
      dotOff: {
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: 'var(--dsw-alias-text-secondary, #999)',
        display: 'inline-block',
      },
      hint: {
        margin: 0,
        fontSize: '12px',
        lineHeight: 1.6,
        color: 'var(--dsw-alias-text-secondary, #777)',
      },
      error: { margin: 0, fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-error, #c62828)' },
      notice: { margin: 0, fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-success, #15803d)' },
      tool: {
        display: 'grid',
        gap: '10px',
        padding: '12px 0',
        color: 'var(--dsw-alias-text-primary, inherit)',
      },
      toolHeader: { display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' },
      toolTitle: { fontSize: '13px', fontWeight: 600 },
      small: { fontSize: '12px', color: 'var(--dsw-alias-text-secondary, #777)' },
      gallery: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
      thumb: {
        position: 'relative',
        display: 'block',
        width: '220px',
        maxWidth: '100%',
        borderRadius: '8px',
        overflow: 'hidden',
        border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.25))',
        background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.08))',
      },
      img: { display: 'block', width: '100%', height: '220px', objectFit: 'cover' },
      placeholder: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '220px',
        padding: '10px',
        boxSizing: 'border-box',
        textAlign: 'center',
        fontSize: '12px',
        color: 'var(--dsw-alias-text-secondary, #777)',
      },
      failure: { margin: 0, fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-error, #c62828)' },
      details: { fontSize: '12px', color: 'var(--dsw-alias-text-secondary, #777)' },
      pre: {
        margin: '6px 0 0',
        padding: '8px',
        borderRadius: '6px',
        background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.08))',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontSize: '12px',
      },
    };

    function Thumb(props) {
      const item = props.item || {};
      const loadImage = props.loadImage;
      const [src, setSrc] = React.useState(item.url || null);
      const [failed, setFailed] = React.useState(false);
      const attachmentId = item.attachment && item.attachment.attachmentId;

      React.useEffect(() => {
        let cancelled = false;
        if (!loadImage || !item.attachment) return undefined;
        const candidates = [
          item.attachment,
          item.attachment.attachmentId,
          { type: 'image', attachment: item.attachment },
          item,
        ];
        (async () => {
          for (const candidate of candidates) {
            try {
              const value = await loadImage(candidate);
              const url =
                typeof value === 'string'
                  ? value
                  : value && typeof value.url === 'string'
                    ? value.url
                    : undefined;
              if (url) {
                if (!cancelled) setSrc(url);
                return;
              }
            } catch {
              /* try the next candidate shape */
            }
          }
          if (!cancelled) setFailed(true);
        })();
        return () => {
          cancelled = true;
        };
      }, [attachmentId, item.url, loadImage]);

      const onClick = (event) => {
        if (!src) event.preventDefault();
      };

      return h(
        'a',
        {
          href: src || '#',
          target: src ? '_blank' : undefined,
          rel: 'noreferrer',
          style: styles.thumb,
          title: t('tool.open'),
          onClick,
        },
        src
          ? h('img', { src, alt: t('tool.images'), style: styles.img })
          : h('span', { style: styles.placeholder }, failed ? t('tool.noImage') : t('tool.unavailable')),
      );
    }

    function ToolView(props) {
      const phase = props.phase;
      const block = props.block || {};
      const loadImage = props.loadImage;
      const prompt =
        (block.args && block.args.prompt) ||
        (block.input && block.input.prompt) ||
        (block.arguments && block.arguments.prompt) ||
        '';

      if (phase !== 'result') {
        return h(
          'div',
          { style: styles.tool },
          h(
            'div',
            { style: styles.toolHeader },
            h('span', { style: styles.toolTitle }, t('tool.title')),
            h('span', { style: styles.small }, phase === 'preparing' ? t('tool.waiting') : t('tool.generating')),
          ),
          prompt ? h('div', { style: styles.pre }, prompt) : null,
        );
      }

      let meta = block.meta;
      if (typeof meta === 'string') {
        try {
          meta = JSON.parse(meta);
        } catch {
          meta = undefined;
        }
      }
      const content = Array.isArray(block.content) ? block.content : [];
      const text = content
        .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n');
      const failed = block.isError === true || /^Error:/.test(text);

      let images = meta && Array.isArray(meta.images) ? meta.images.filter((image) => image && image.attachment) : [];
      if (images.length === 0) {
        images = content
          .filter((part) => part && part.type === 'image' && part.attachment)
          .map((part) => ({ attachment: part.attachment }));
      }
      const failures = meta && Array.isArray(meta.failures) ? meta.failures : [];
      const revised = meta && Array.isArray(meta.revisedPrompts) ? meta.revisedPrompts.filter(Boolean) : [];
      const requestId = (meta && meta.requestId) || undefined;

      return h(
        'div',
        { style: styles.tool },
        h(
          'div',
          { style: styles.toolHeader },
          h('span', { style: styles.toolTitle }, failed ? t('tool.error') : t('tool.title')),
          meta && meta.model ? h('span', { style: styles.small }, meta.model) : null,
          requestId ? h('span', { style: styles.small }, `${t('tool.requestId')}: ${requestId}`) : null,
        ),
        images.length > 0
          ? h(
              'div',
              { style: styles.gallery },
              images.map((image, index) =>
                h(Thumb, {
                  key: (image.attachment && image.attachment.attachmentId) || String(index),
                  item: image,
                  loadImage,
                }),
              ),
            )
          : null,
        failures.length > 0
          ? h(
              'div',
              null,
              h('div', { style: styles.small }, t('tool.failures')),
              failures.map((failure, index) =>
                h(
                  'p',
                  { key: String(index), style: styles.failure },
                  `image ${Number(failure.index) + 1}: ${failure.code || 'ERROR'} - ${failure.message || ''}`,
                ),
              ),
            )
          : null,
        text ? h('pre', { style: styles.pre }, text) : null,
        revised.length > 0
          ? h(
              'details',
              { style: styles.details },
              h('summary', null, t('tool.revisedPrompt')),
              revised.map((value, index) => h('pre', { key: String(index), style: styles.pre }, value)),
            )
          : null,
      );
    }

    function SettingsSection() {
      const [state, setState] = React.useState({ loading: true, unavailable: false, info: {} });
      const [value, setValue] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');
      const [notice, setNotice] = React.useState('');

      const request = async (action, next) => {
        const response = await fetch('/minimax-image/credential', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(next === undefined ? { action } : { action, value: next }),
        });
        let payload = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
        if (!response.ok || !payload || payload.ok !== true) {
          const message =
            payload && typeof payload.error === 'string'
              ? payload.error
              : `HTTP ${response.status}`;
          const failure = new Error(message);
          failure.status = response.status;
          throw failure;
        }
        return payload;
      };

      const unavailableStatus = (cause) =>
        cause && (cause.status === 404 || cause.status === 503 || cause.name === 'TypeError');

      const refresh = async () => {
        try {
          const payload = await request('describe');
          setState({ loading: false, unavailable: false, info: payload.info || {} });
          setError('');
        } catch (cause) {
          const unavailable = unavailableStatus(cause);
          setState({ loading: false, unavailable, info: {} });
          if (!unavailable) setError(String((cause && cause.message) || cause));
        }
      };

      React.useEffect(() => {
        refresh();
      }, []);

      const save = async () => {
        const next = value.trim();
        if (!next) {
          setError(t('settings.empty'));
          return;
        }
        setBusy(true);
        setError('');
        setNotice('');
        try {
          await request('set', next);
          setValue('');
          setNotice(t('settings.saved'));
          await refresh();
        } catch (cause) {
          if (unavailableStatus(cause)) {
            setState({ loading: false, unavailable: true, info: {} });
            setError(t('settings.unavailable'));
          } else {
            setError(t('settings.error') + String((cause && cause.message) || cause));
          }
        } finally {
          setBusy(false);
        }
      };

      const remove = async () => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
          await request('unset');
          setNotice(t('settings.removed'));
          await refresh();
        } catch (cause) {
          if (unavailableStatus(cause)) {
            setState({ loading: false, unavailable: true, info: {} });
            setError(t('settings.unavailable'));
          } else {
            setError(t('settings.error') + String((cause && cause.message) || cause));
          }
        } finally {
          setBusy(false);
        }
      };

      const info = state.info || {};
      const configured = info.configured === true;
      const writable = info.writable !== false;
      const source =
        info.source === 'stored'
          ? t('settings.source.stored')
          : info.source === 'environment'
            ? t('settings.source.environment')
            : t('settings.source.unknown');

      return h(
        'section',
        { style: styles.section },
        h('h2', { style: styles.title }, t('settings.title')),
        h('p', { style: styles.description }, t('settings.description')),
        h(
          'div',
          { style: styles.card },
          state.loading
            ? h('p', { style: styles.hint }, t('settings.loading'))
            : state.unavailable
              ? h('p', { style: styles.hint }, t('settings.unavailable'))
              : h(
                  React.Fragment,
                  null,
                  h(
                    'div',
                    { style: styles.status },
                    h('span', { style: configured ? styles.dotOk : styles.dotOff }),
                    h('span', null, configured ? t('settings.configured') : t('settings.notConfigured')),
                    configured ? h('span', { style: styles.small }, `(${source})`) : null,
                  ),
                  !writable ? h('p', { style: styles.hint }, t('settings.readonly')) : null,
                  h('span', { style: styles.label }, t('settings.keyLabel')),
                  h('input', {
                    type: 'password',
                    autoComplete: 'off',
                    spellCheck: false,
                    value,
                    placeholder: t('settings.keyPlaceholder'),
                    style: styles.input,
                    disabled: busy || !writable,
                    onChange: (event) => setValue(event.target.value),
                  }),
                  h(
                    'div',
                    { style: styles.row },
                    h(
                      'button',
                      { type: 'button', style: styles.button, disabled: busy || !writable, onClick: save },
                      busy ? t('settings.saving') : t('settings.save'),
                    ),
                    configured
                      ? h(
                          'button',
                          { type: 'button', style: styles.buttonSecondary, disabled: busy || !writable, onClick: remove },
                          busy ? t('settings.removing') : t('settings.remove'),
                        )
                      : null,
                  ),
                  error ? h('p', { style: styles.error }, error) : null,
                  notice ? h('p', { style: styles.notice }, notice) : null,
                ),
        ),
        h('p', { style: styles.hint }, t('settings.endpoint')),
        h('p', { style: styles.hint }, t('settings.privacy')),
        h('p', { style: styles.hint }, t('settings.billing')),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        runtimeCtx = ctx;
        const registerLocale = (locale, dict) => {
          try {
            ctx.locale.register(NS, locale, dict);
          } catch (error) {
            const message = error && error.message ? error.message : String(error);
            if (!message.includes('already has locale')) throw error;
          }
        };
        registerLocale('en', EN);
        registerLocale('zh', ZH);
        t = ctx.locale.bind(NS);

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'minimax-image',
              order: 46,
              label: () => t('settings.title'),
            },
            SettingsSection,
          ),
        );

        ctx.slots.inject('tool.call.toolview', () =>
          ctx.slots.register(
            {
              name: 'tool.call.toolview',
              key: 'minimax_generate_image',
              id: 'minimax-image-toolview',
            },
            ToolView,
          ),
        );
      },
    };
  },
});
