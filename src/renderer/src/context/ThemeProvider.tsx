import { isMac, isWin } from '@renderer/config/constant'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import useUserTheme from '@renderer/hooks/useUserTheme'
import { ThemeMode } from '@renderer/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { PropsWithChildren } from 'react'
import React, { createContext, use, useEffect, useState } from 'react'

interface ThemeContextType {
  theme: ThemeMode
  settedTheme: ThemeMode
  toggleTheme: () => void
  setTheme: (theme: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: ThemeMode.light,
  settedTheme: ThemeMode.light,
  toggleTheme: () => {},
  setTheme: () => {}
})

interface ThemeProviderProps extends PropsWithChildren {
  defaultTheme?: ThemeMode
}

const tailwindThemeChange = (theme: ThemeMode) => {
  const root = window.document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(theme)
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  // 用户设置的主题
  const { theme: settedTheme, setTheme: setSettedTheme, language } = useSettings()
  const [actualTheme, setActualTheme] = useState<ThemeMode>(ThemeMode.light)
  const { initUserTheme } = useUserTheme()
  const { navbarPosition } = useNavbarPosition()

  const toggleTheme = () => {
    setSettedTheme(ThemeMode.light)
  }

  const setTheme = (_theme: ThemeMode) => {
    setSettedTheme(ThemeMode.light)
  }

  useEffect(() => {
    // Set initial theme and OS attributes on body
    document.body.setAttribute('os', isMac ? 'mac' : isWin ? 'windows' : 'linux')
    document.body.setAttribute('theme-mode', actualTheme)
    document.body.classList.remove('dark')
    document.body.classList.add('light')
    document.body.setAttribute('navbar-position', navbarPosition)
    document.documentElement.lang = language

    if (settedTheme !== ThemeMode.light) {
      setSettedTheme(ThemeMode.light)
    }

    initUserTheme()

    // listen for theme updates from main process
    return window.electron.ipcRenderer.on(IpcChannel.ThemeUpdated, () => {
      document.body.setAttribute('theme-mode', ThemeMode.light)
      setActualTheme(ThemeMode.light)
    })
  }, [actualTheme, initUserTheme, language, navbarPosition, setSettedTheme, settedTheme])

  useEffect(() => {
    tailwindThemeChange(actualTheme)
  }, [actualTheme])

  useEffect(() => {
    void window.api.setTheme(settedTheme)
  }, [settedTheme])

  return (
    <ThemeContext value={{ theme: actualTheme, settedTheme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext>
  )
}

export const useTheme = () => use(ThemeContext)
