/**
 * Side-effect module: pin the UI language to Simplified Chinese BEFORE
 * `@/i18n` is imported (i18next + language detector read `i18nextLng` at init).
 * Used only by the visual evidence harness.
 */
localStorage.setItem('i18nextLng', 'zh-Hans');
