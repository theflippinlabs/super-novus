/* i18n — minimal, dependency-free localization.
   Dictionaries are plain JSON (see ./locales). Static DOM text is translated via
   [data-i18n] attributes; dynamic strings call t(). Switching language re-applies
   the whole DOM and notifies listeners — no reload. Choice persists in localStorage. */
import fr from "./locales/fr.json";
import en from "./locales/en.json";
import ko from "./locales/ko.json";
import { LANGUAGES, LANG_KEY, DEFAULT_LANG, type Lang } from "../config";

type Dict = Record<string, string>;
const DICTS: Record<Lang, Dict> = { fr, en, ko };
const isLang = (s: string): s is Lang => (LANGUAGES as readonly string[]).includes(s);

class I18n {
  private lang: Lang = DEFAULT_LANG;
  private listeners = new Set<() => void>();

  constructor() { this.lang = this.load(); }

  private load(): Lang {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved && isLang(saved)) return saved;
    } catch { /* private mode */ }
    const nav = (navigator.language || "").slice(0, 2).toLowerCase();
    return isLang(nav) ? nav : DEFAULT_LANG;
  }

  get(): Lang { return this.lang; }

  /** Switch language, persist it, re-apply the DOM, and notify listeners. */
  set(lang: Lang): void {
    if (!isLang(lang)) return;
    this.lang = lang;
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
    document.documentElement.lang = lang;
    this.apply();
    for (const cb of this.listeners) cb();
  }

  onChange(cb: () => void): void { this.listeners.add(cb); }

  /** Translate a key with optional {param} substitution. Falls back to EN, then the key. */
  t(key: string, params?: Record<string, string | number>): string {
    let s = DICTS[this.lang][key] ?? DICTS.en[key] ?? key;
    if (params) for (const k in params) s = s.split(`{${k}}`).join(String(params[k]));
    return s;
  }

  /** Apply translations to a DOM subtree (default: whole document). */
  apply(root: ParentNode = document): void {
    root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => { el.textContent = this.t(el.dataset.i18n!); });
    root.querySelectorAll<HTMLElement>("[data-i18n-html]").forEach((el) => { el.innerHTML = this.t(el.dataset.i18nHtml!); });
    root.querySelectorAll<HTMLElement>("[data-i18n-ph]").forEach((el) => { (el as HTMLInputElement).placeholder = this.t(el.dataset.i18nPh!); });
    root.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", this.t(el.dataset.i18nAria!)); });
  }
}

export const i18n = new I18n();
export const t = (key: string, params?: Record<string, string | number>): string => i18n.t(key, params);
