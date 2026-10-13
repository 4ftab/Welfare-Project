// src/LanguageContext.jsx

import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

import translations from "./translations";

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(() => {
    return localStorage.getItem("website-language") || "en";
  });

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir =
      language === "ur" ? "rtl" : "ltr";

    localStorage.setItem("website-language", language);
  }, [language]);

  const toggleLanguage = () => {
    setLanguage((current) => (current === "en" ? "ur" : "en"));
  };

  const t = (key) => {
    return translations[language]?.[key] ?? translations.en[key] ?? key;
  };

  return (
    <LanguageContext.Provider
      value={{ language, setLanguage, toggleLanguage, t }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error(
      "useLanguage must be used inside LanguageProvider"
    );
  }

  return context;
}