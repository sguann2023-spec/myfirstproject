import 'dayjs/locale/de'
import 'dayjs/locale/el'
import 'dayjs/locale/es'
import 'dayjs/locale/fr'
import 'dayjs/locale/ja'
import 'dayjs/locale/pt'
import 'dayjs/locale/ro'
import 'dayjs/locale/ru'
import 'dayjs/locale/vi'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/zh-tw'

import { loggerService } from '@logger'
import { defaultLanguage } from '@shared/config/constant'
import dayjs from 'dayjs'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// Original translation
import enUS from './locales/en-us.json'
import zhCN from './locales/zh-cn.json'
import zhTW from './locales/zh-tw.json'
import legacyEnUS from '../../../../locales/en/translation.json'
import legacyZhCN from '../../../../locales/zh/translation.json'
// Machine translation
import deDE from './translate/de-de.json'
import elGR from './translate/el-gr.json'
import esES from './translate/es-es.json'
import frFR from './translate/fr-fr.json'
import jaJP from './translate/ja-jp.json'
import ptPT from './translate/pt-pt.json'
import roRO from './translate/ro-ro.json'
import ruRU from './translate/ru-ru.json'
import viVN from './translate/vi-vn.json'

const logger = loggerService.withContext('I18N')

const resources = {
  'en-US': { translation: enUS, legacy: legacyEnUS },
  'ja-JP': { translation: jaJP },
  'ru-RU': { translation: ruRU },
  'zh-CN': { translation: zhCN, legacy: legacyZhCN },
  'zh-TW': { translation: zhTW },
  'de-DE': { translation: deDE },
  'el-GR': { translation: elGR },
  'es-ES': { translation: esES },
  'fr-FR': { translation: frFR },
  'pt-PT': { translation: ptPT },
  'ro-RO': { translation: roRO },
  'vi-VN': { translation: viVN }
}

const languageAliasMap: Record<string, string> = {
  en: 'en-US',
  'en-us': 'en-US',
  zh: 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-tw': 'zh-TW',
  'zh-hk': 'zh-TW',
  'zh-hant': 'zh-TW',
  de: 'de-DE',
  'de-de': 'de-DE',
  el: 'el-GR',
  'el-gr': 'el-GR',
  es: 'es-ES',
  'es-es': 'es-ES',
  fr: 'fr-FR',
  'fr-fr': 'fr-FR',
  ja: 'ja-JP',
  'ja-jp': 'ja-JP',
  pt: 'pt-PT',
  'pt-pt': 'pt-PT',
  ro: 'ro-RO',
  'ro-ro': 'ro-RO',
  ru: 'ru-RU',
  'ru-ru': 'ru-RU',
  vi: 'vi-VN',
  'vi-vn': 'vi-VN'
}

export const normalizeLanguage = (rawLanguage?: string | null) => {
  if (!rawLanguage) {
    return defaultLanguage
  }

  if (resources[rawLanguage as keyof typeof resources]) {
    return rawLanguage
  }

  const lowerCased = rawLanguage.toLowerCase()
  const directAlias = languageAliasMap[lowerCased]
  if (directAlias) {
    return directAlias
  }

  const languageCode = lowerCased.split('-')[0]
  return languageAliasMap[languageCode] || defaultLanguage
}

export const getLanguage = () => {
  const language = localStorage.getItem('language') || defaultLanguage
  return normalizeLanguage(language)
}

export const getLanguageCode = () => {
  return getLanguage().split('-')[0]
}

// Map i18n language codes to dayjs locale codes
const dayjsLocaleMap: Record<string, string> = {
  'en-US': 'en',
  'ja-JP': 'ja',
  'ru-RU': 'ru',
  'zh-CN': 'zh-cn',
  'zh-TW': 'zh-tw',
  'de-DE': 'de',
  'el-GR': 'el',
  'es-ES': 'es',
  'fr-FR': 'fr',
  'pt-PT': 'pt',
  'ro-RO': 'ro',
  'vi-VN': 'vi'
}

export const setDayjsLocale = (language: string) => {
  const dayjsLocale = dayjsLocaleMap[language] || 'en'
  dayjs.locale(dayjsLocale)
}

void i18n.use(initReactI18next).init({
  resources,
  lng: getLanguage(),
  fallbackLng: defaultLanguage,
  interpolation: {
    escapeValue: false
  },
  saveMissing: true,
  missingKeyHandler: (_1, _2, key) => {
    logger.error(`Missing key: ${key}`)
  }
})

export default i18n
