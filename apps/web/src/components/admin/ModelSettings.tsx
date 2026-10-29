'use client';

// 管理后台「模型设置」:三条链路的模型名查看/切换。
// V1 简化:生图即时生效(web 读 DB);成稿/改书保存后提示需重启容器。

import { useCallback, useEffect, useState } from 'react';

type ModelConfig = {
  defaults: Record<string, string>;
  overrides: Record<string, string>;
  effective: Record<string, string>;
};

type ModelOption = {
  model: string;
  input_price?: string;
  output_price?: string;
};

const CHAINS: Array<{ key: string; label: string; restart: boolean }> = [
  { key: 'compose_model', label: '成稿(文案生成)', restart: true },
  { key: 'design_model', label: '改书(对话编辑)', restart: true },
  { key: 'image_model', label: '生图(AI 图片生成)', restart: false },
];

export default function ModelSettings() {
  const [config, setConfig] = useState<ModelConfig | null>(null);
  const [options, setOptions] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const [cfgRes, optRes] = await Promise.all([
        fetch('/api/v1/admin/model-config'),
        fetch('/api/v1/admin/model-options'),
      ]);
      const cfg = await cfgRes.json();
      const opt = await optRes.json();
      if (cfg.ok) setConfig(cfg.data);
      if (opt.ok) setOptions(opt.data.models ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async (key: string, value: string | null) => {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/v1/admin/model-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      const json = await res.json();
      if (json.ok) {
        setMessage(value === null ? '已重置为默认值' : `已切换为 ${value}`);
        await load(); // 刷新
      } else {
        setMessage(`保存失败: ${json.error?.message ?? 'unknown'}`);
      }
    } catch {
      setMessage('保存失败: 网络错误');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-4 text-neutral-500">加载中…</div>;
  if (!config) return <div className="p-4 text-red-500">配置加载失败</div>;

  return (
    <div className="space-y-4">
      {message && (
        <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-700">{message}</div>
      )}
      {CHAINS.map(({ key, label, restart }) => {
        const effective = config.effective[key] ?? '';
        const isOverridden = Boolean(config.overrides[key]);
        return (
          <div key={key} className="rounded-lg border border-neutral-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium">{label}</h3>
                <p className="mt-1 text-sm text-neutral-600">
                  当前模型: <code className="rounded bg-neutral-100 px-1.5 py-0.5">{effective}</code>
                  {isOverridden && (
                    <span className="ml-2 text-xs text-amber-600">(已覆盖默认 {config.defaults[key]})</span>
                  )}
                </p>
                {restart && (
                  <p className="mt-1 text-xs text-neutral-400">
                    保存后需重启容器生效(docker compose up -d,约 30 秒)
                  </p>
                )}
                {!restart && (
                  <p className="mt-1 text-xs text-green-600">保存后即时生效</p>
                )}
              </div>
              <div className="flex gap-2">
                <select
                  className="rounded border border-neutral-300 px-2 py-1 text-sm"
                  value=""
                  onChange={(e) => e.target.value && void save(key, e.target.value)}
                  disabled={saving}
                >
                  <option value="">切换模型…</option>
                  {options.map((opt) => (
                    <option key={opt.model} value={opt.model}>
                      {opt.model}
                      {opt.input_price ? ` (¥${opt.input_price}/1K in)` : ''}
                    </option>
                  ))}
                </select>
                {isOverridden && (
                  <button
                    className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50"
                    onClick={() => void save(key, null)}
                    disabled={saving}
                  >
                    重置默认
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
