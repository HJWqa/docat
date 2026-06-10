import en from "./en";
import zh from "./zh";
import de from "./de";
import ja from "./ja";
import ko from "./ko";
import ru from "./ru";
import es from "./es";
import hk from "./hk";
import i18n, { Resource } from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  en: {
    translation: en,
  },
  zh: {
    translation: zh,
  },
  de: {
    translation: de,
  },
  ja: {
    translation: ja,
  },
  ko: {
    translation: ko,
  },
  ru: {
    translation: ru,
  },
  es: {
    translation: es,
  },
  hk: {
    translation: hk,
  },
};
i18n.use(initReactI18next).init({
  resources,
  lng: "zh",
  keySeparator: false,
  interpolation: {
    escapeValue: false,
  },
  fallbackLng: "en",
});

export const addLocale = (newResources: Resource) => {
  Object.keys(newResources).forEach((language) => {
    if (i18n.hasResourceBundle(language, "translation")) {
      i18n.removeResourceBundle(language, "translation");
    }
    i18n.addResourceBundle(
      language,
      "translation",
      newResources[language as keyof typeof resources],
      true,
      true
    );
  });
  i18n.reloadResources();
};

export default i18n;
