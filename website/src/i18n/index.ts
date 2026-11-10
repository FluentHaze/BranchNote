import zhCN from "./locales/zh-CN.json";
import zhTW from "./locales/zh-TW.json";
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";

export const locales = ["zh-CN", "zh-TW", "en", "ja", "ko"] as const;
export type Locale = (typeof locales)[number];
export type Copy = typeof zhCN;

export const translations: Record<Locale, Copy> = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  en,
  ja,
  ko,
};

export const languageNames: Record<Locale, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
};

export const withBase = (path: string) => `${import.meta.env.BASE_URL.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;

export const languagePath = (locale: Locale) => withBase(`${locale}/`);
