export type LocaleOption = {
  id: string;
  label: string;
};

export const DEFAULT_UI_LOCALE = 'zh-CN';

/** Catalog used when the active locale is missing a message key. */
export const FALLBACK_UI_LOCALE = 'en';

// Add new languages by appending to this list and providing message dictionaries.
export const SUPPORTED_UI_LOCALES: LocaleOption[] = [
  { id: 'zh-CN', label: '简体中文' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'en', label: 'English' },
];

const isSupportedLocale = (locale: string): boolean => {
  return SUPPORTED_UI_LOCALES.some((l) => l.id === locale);
};

export const resolveSupportedLocale = (locale: string): string => {
  if (isSupportedLocale(locale)) return locale;
  const base = locale.split('-')[0] || locale;
  const baseExact = SUPPORTED_UI_LOCALES.find((l) => l.id === base)?.id;
  if (baseExact) return baseExact;
  const basePrefix = SUPPORTED_UI_LOCALES.find((l) => l.id.startsWith(`${base}-`))?.id;
  if (basePrefix) return basePrefix;
  return DEFAULT_UI_LOCALE;
};

