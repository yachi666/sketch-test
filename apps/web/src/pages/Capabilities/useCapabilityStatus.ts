import { useEffect, useState } from 'react';
import { cpClient, planClient } from '../../lib/cp-client';
import type { SignalKey } from './catalog';

export interface Signal {
  label: string;
  detail: string;
  tone: 'ready' | 'attention' | 'neutral';
  failed?: boolean;
}
type Signals = Partial<Record<SignalKey, Signal>>;

export function useCapabilityStatus(workspaceId: string | undefined) {
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    workspaceId?: string;
    revision: number;
    signals: Signals;
    updatedAt: Date;
  }>();

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    const load = async () => {
      const loaders: Array<[SignalKey, () => Promise<Signal>]> = [
        [
          'apis',
          async () => {
            const { apiVersions } = await cpClient.listApiVersions();
            return {
              label: apiVersions.length ? `${apiVersions.length} 个 API 版本` : '尚未接入',
              detail: '当前工作区已保存的接口版本',
              tone: apiVersions.length ? 'ready' : 'neutral',
            };
          },
        ],
        [
          'ai',
          async () => {
            const status = await cpClient.aiCapabilities();
            return {
              label: status.available
                ? '生成服务可用'
                : status.configured
                  ? '生成服务不可用'
                  : '尚未配置',
              detail: '测试草稿生成服务的当前状态',
              tone: status.available ? 'ready' : 'attention',
            };
          },
        ],
        [
          'plans',
          async () => {
            const { settings } = await planClient.list();
            return {
              label: settings.enabled ? '自动建议已开启' : '自动建议未开启',
              detail: '开启状态不代表生成服务在线',
              tone: settings.enabled ? 'ready' : 'neutral',
            };
          },
        ],
        [
          'schedules',
          async () => {
            const { schedules } = await cpClient.listSchedules();
            return {
              label: `${schedules.length} 条定时规则`,
              detail: `${schedules.filter((schedule) => schedule.enabled).length} 条规则已启用 · 按 UTC 定时派发`,
              tone: 'attention',
            };
          },
        ],
        [
          'environments',
          async () => {
            const { environments } = await cpClient.listEnvironments(workspaceId);
            return {
              label: environments.length ? `${environments.length} 个环境` : '尚未配置环境',
              detail: '仅表示配置数量，不代表执行就绪',
              tone: environments.length ? 'ready' : 'neutral',
            };
          },
        ],
      ];
      const results = await Promise.allSettled(
        loaders.map(async ([key, loader]) => ({ key, signal: await loader() })),
      );
      if (cancelled) return;
      const signals: Signals = {};
      results.forEach((result, index) => {
        const key = loaders[index]?.[0];
        if (!key) return;
        signals[key] =
          result.status === 'fulfilled'
            ? result.value.signal
            : {
                label: '状态未知',
                detail: '读取失败或没有查看权限，请刷新重试。',
                tone: 'neutral',
                failed: true,
              };
      });
      setSnapshot({ workspaceId, revision, signals, updatedAt: new Date() });
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, revision]);

  const current =
    snapshot?.workspaceId === workspaceId && snapshot?.revision === revision ? snapshot : undefined;
  const loading = Boolean(workspaceId && !current);
  return {
    loading,
    updatedAt: current?.updatedAt,
    hasError: Object.values(current?.signals ?? {}).some((signal) => signal.failed),
    refresh: () => setRevision((value) => value + 1),
    signal: (key: SignalKey): Signal =>
      current?.signals[key] ?? {
        label: loading ? '正在读取…' : '尚未连接工作区',
        detail: loading ? '读取当前工作区状态' : '连接后显示真实状态，功能介绍仍可浏览。',
        tone: 'neutral',
      },
  };
}
