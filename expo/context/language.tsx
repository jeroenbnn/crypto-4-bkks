import createContextHook from '@nkzw/create-context-hook';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Language, translations, Translations } from '@/constants/i18n';

const LANGUAGE_KEY = 'app_language';
const DEFAULT_LANGUAGE: Language = 'nl';

export const [LanguageProvider, useLanguage] = createContextHook(() => {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const stored = await AsyncStorage.getItem(LANGUAGE_KEY);
        if (stored === 'nl' || stored === 'fr' || stored === 'en') {
          setLanguageState(stored);
        }
      } catch (e) {
        console.error('[Language] Error loading language:', e);
      } finally {
        setInitialized(true);
      }
    })();
  }, []);

  const setLanguage = useCallback(async (lang: Language) => {
    setLanguageState(lang);
    try {
      await AsyncStorage.setItem(LANGUAGE_KEY, lang);
    } catch (e) {
      console.error('[Language] Error saving language:', e);
    }
  }, []);

  const t: Translations = useMemo(() => translations[language], [language]);

  return useMemo(() => ({ language, setLanguage, t, initialized }), [language, setLanguage, t, initialized]);
});
