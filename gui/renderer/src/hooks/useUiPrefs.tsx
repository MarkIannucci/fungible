import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

type UiPrefs = {
  theme: Theme;
  toggleTheme: () => void;
  keys: boolean;
  toggleKeys: () => void;
};

const Ctx = createContext<UiPrefs>({ theme: 'dark', toggleTheme: () => {}, keys: false, toggleKeys: () => {} });

export function UiPrefsProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('fungible-theme') === 'light' ? 'light' : 'dark'));
  const [keys, setKeys] = useState<boolean>(() => localStorage.getItem('fungible-keys') === 'on');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('fungible-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('fungible-keys', keys ? 'on' : 'off');
  }, [keys]);

  return (
    <Ctx.Provider
      value={{
        theme,
        toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
        keys,
        toggleKeys: () => setKeys((k) => !k),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useUiPrefs(): UiPrefs {
  return useContext(Ctx);
}
