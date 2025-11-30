// src/context/LanguageContext.tsx

import React, { createContext, useState, useEffect } from 'react';
import { getItem, setItem } from '../utils/safeStorage';

type Language = 'es' | 'en';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
}

export const LanguageContext = createContext<LanguageContextType>({
  language: 'es',
  setLanguage: () => {},
});

export const LanguageProvider = ({ children }: { children: React.ReactNode }) => {
  const [language, setLanguageState] = useState<Language>('es');

  useEffect(() => {
    const storedLang = getItem('language') as Language;
    if (storedLang) setLanguageState(storedLang);
  }, []);

  const setLanguage = (lang: Language) => {
    setItem('language', lang);
    setLanguageState(lang);
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
};