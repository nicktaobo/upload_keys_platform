/// <reference types="vite/client" />
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type Language = "en" | "zh";
type Dictionary = Record<string, string>;

const en: Dictionary = {
  "nav.keys": "My Keys", "nav.submit": "Submit Key", "nav.users": "Users", "nav.allKeys": "All Keys", "nav.upstream": "Upstream", "nav.operations": "Operations", "action.signOut": "Sign out", "action.language": "Language", "language.en": "English", "language.zh": "中文", "common.loading": "Loading KeyHub", "common.never": "Never", "common.noSamples": "No samples", "common.noRecords": "No records yet", "common.loadFailed": "Unable to load data", "status.pending": "Pending", "status.submitting": "Submitting", "status.submitted": "Submitted", "status.test_failed": "Test failed", "status.retrying": "Retrying", "status.upstream_error": "Upstream error", "action.retry": "Retry", "action.refresh": "Refresh", "action.sync": "Sync now", "action.save": "Save", "action.create": "Create", "action.reset": "Reset", "action.disable": "Disable", "action.done": "Done",
};
const zh: Dictionary = { ...en, "nav.keys": "我的 Key", "nav.submit": "提交 Key", "nav.users": "用户管理", "nav.allKeys": "全部 Key", "nav.upstream": "上游配置", "nav.operations": "运维操作", "action.signOut": "退出登录", "action.language": "语言", "language.en": "English", "language.zh": "中文", "common.loading": "正在加载 KeyHub", "common.never": "从未", "common.noSamples": "暂无采样", "common.noRecords": "暂无记录", "common.loadFailed": "数据加载失败", "status.pending": "待处理", "status.submitting": "提交中", "status.submitted": "已提交", "status.test_failed": "测试失败", "status.retrying": "重试中", "status.upstream_error": "上游错误", "action.retry": "重试", "action.refresh": "刷新", "action.sync": "立即同步", "action.save": "保存", "action.create": "创建", "action.reset": "重置", "action.disable": "停用", "action.done": "完成" };
Object.assign(zh, { "login.title": "登录", "login.subtitle": "访问您的供应商 Key 工作台。", "login.failed": "登录失败", "login.username": "用户名", "login.password": "密码", "login.enterUsername": "请输入用户名", "login.enterPassword": "请输入密码", "login.signIn": "登录", "keys.title": "我的 Key", "keys.subtitle": "查看提交状态和上游用量。", "keys.submitted": "已提交 Key", "keys.healthy": "健康", "keys.usage": "累计用量", "keys.latest": "最近采样", "submit.title": "提交 Key", "submit.subtitle": "Key 将提交到固定的 Claude 官方 API 渠道。", "submit.channel": "渠道", "submit.single": "单个提交", "submit.batch": "批量粘贴", "submit.apiKey": "API Key", "submit.warranty": "质保小时数", "submit.submit": "提交 Key", "submit.batchLabel": "Key 和质保时间", "submit.ready": "可提交", "submit.duplicates": "重复", "submit.invalid": "无效", "submit.total": "总行数", "submit.batchSubmit": "提交批量 Key" });

interface I18nValue { language: Language; setLanguage: (language: Language) => void; t: (key: string, fallback?: string) => string }
const I18nContext = createContext<I18nValue | null>(null);
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => (localStorage.getItem("keyhub-language") as Language) || (import.meta.env.MODE === "test" ? "en" : "zh"));
  const setLanguage = (next: Language) => { localStorage.setItem("keyhub-language", next); setLanguageState(next); };
  const value = useMemo(() => ({ language, setLanguage, t: (key: string, fallback?: string) => (language === "zh" ? zh[key] : en[key]) ?? fallback ?? key }), [language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export function useI18n(): I18nValue { const value = useContext(I18nContext); if (!value) throw new Error("I18nProvider is missing"); return value; }
