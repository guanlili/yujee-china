'use client';

// 管理后台「更新日志」:列表 + 新建/编辑/删除/发布切换。
import { useCallback, useEffect, useState } from 'react';

type Entry = {
  id: string;
  category: string;
  titleZh: string; titleEn: string;
  bodyZh: string; bodyEn: string;
  imageUrl: string | null;
  publishedAt: string;
  isPublished: boolean;
};

type FormData = {
  category: string;
  titleZh: string; titleEn: string;
  bodyZh: string; bodyEn: string;
  imageUrl: string;
  isPublished: boolean;
};

const EMPTY: FormData = {
  category: 'feature', titleZh: '', titleEn: '', bodyZh: '', bodyEn: '', imageUrl: '', isPublished: false,
};

const CATEGORIES = [
  { value: 'feature', label: '🆕 新功能' },
  { value: 'improvement', label: '🔧 优化' },
  { value: 'notice', label: '💬 通知' },
  { value: 'fix', label: '🐛 修复' },
];

export default function ChangelogAdmin() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [message, setMessage] = useState('');
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/admin/changelog');
      const json = await res.json();
      if (json.ok) setEntries(json.data.entries);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const startNew = () => { setEditing(null); setForm(EMPTY); setShowForm(true); setMessage(''); };
  const startEdit = (e: Entry) => {
    setEditing(e);
    setForm({
      category: e.category, titleZh: e.titleZh, titleEn: e.titleEn,
      bodyZh: e.bodyZh, bodyEn: e.bodyEn, imageUrl: e.imageUrl ?? '', isPublished: e.isPublished,
    });
    setShowForm(true); setMessage('');
  };

  const save = async () => {
    setMessage('');
    const payload = { ...form, imageUrl: form.imageUrl || null };
    try {
      const res = await fetch(
        editing ? `/api/v1/admin/changelog/${editing.id}` : '/api/v1/admin/changelog',
        {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const json = await res.json();
      if (json.ok) {
        setMessage(editing ? '已更新' : '已创建');
        setShowForm(false);
        await load();
      } else {
        setMessage(`保存失败: ${json.error?.message ?? 'unknown'}`);
      }
    } catch { setMessage('保存失败: 网络错误'); }
  };

  const togglePublish = async (e: Entry) => {
    await fetch(`/api/v1/admin/changelog/${e.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPublished: !e.isPublished }),
    });
    await load();
  };

  const remove = async (id: string) => {
    if (!confirm('确认删除?')) return;
    await fetch(`/api/v1/admin/changelog/${id}`, { method: 'DELETE' });
    await load();
  };

  if (loading) return <div className="p-4 text-neutral-500">加载中…</div>;

  return (
    <div className="space-y-4">
      {message && <div className="rounded bg-blue-50 p-2 text-sm text-blue-700">{message}</div>}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">更新日志管理</h2>
        <button onClick={startNew} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700">
          + 新建
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-neutral-200 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500">分类</label>
              <select
                className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                value={form.category}
                onChange={(e) => setForm({...form, category: e.target.value})}
              >
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-neutral-500">配图 URL(可选)</label>
              <input
                className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                value={form.imageUrl}
                onChange={(e) => setForm({...form, imageUrl: e.target.value})}
                placeholder="https://..."
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500">标题(中文)</label>
              <input className="w-full rounded border border-neutral-300 px-2 py-1 text-sm" value={form.titleZh}
                onChange={(e) => setForm({...form, titleZh: e.target.value})} />
            </div>
            <div>
              <label className="text-xs text-neutral-500">Title (EN)</label>
              <input className="w-full rounded border border-neutral-300 px-2 py-1 text-sm" value={form.titleEn}
                onChange={(e) => setForm({...form, titleEn: e.target.value})} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500">描述(中文,Markdown)</label>
              <textarea className="w-full rounded border border-neutral-300 px-2 py-1 text-sm" rows={4} value={form.bodyZh}
                onChange={(e) => setForm({...form, bodyZh: e.target.value})} />
            </div>
            <div>
              <label className="text-xs text-neutral-500">Body (EN, Markdown)</label>
              <textarea className="w-full rounded border border-neutral-300 px-2 py-1 text-sm" rows={4} value={form.bodyEn}
                onChange={(e) => setForm({...form, bodyEn: e.target.value})} />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={form.isPublished}
                onChange={(e) => setForm({...form, isPublished: e.target.checked})} />
              发布(取消勾选则为草稿)
            </label>
            <div className="flex gap-2">
              <button onClick={save} className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700">保存</button>
              <button onClick={() => setShowForm(false)} className="rounded border border-neutral-300 px-3 py-1 text-sm">取消</button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {entries.map(e => (
          <div key={e.id} className="flex items-center justify-between rounded border border-neutral-200 p-3">
            <div>
              <span className="text-xs text-neutral-400">
                {new Date(e.publishedAt).toLocaleDateString('zh-CN')}
              </span>{' '}
              <span className={`text-xs ${e.isPublished ? 'text-green-600' : 'text-neutral-400'}`}>
                [{e.isPublished ? '已发布' : '草稿'}]
              </span>{' '}
              <span className="font-medium">{e.titleZh}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => togglePublish(e)} className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50">
                {e.isPublished ? '取消发布' : '发布'}
              </button>
              <button onClick={() => startEdit(e)} className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50">编辑</button>
              <button onClick={() => remove(e.id)} className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50">删除</button>
            </div>
          </div>
        ))}
        {entries.length === 0 && <p className="text-sm text-neutral-400">暂无条目,点击「新建」创建第一条。</p>}
      </div>
    </div>
  );
}
