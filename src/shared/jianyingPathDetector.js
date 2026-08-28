const DRAFT_DIR_NAME = 'com.lveditor.draft';
const CONFIG_KEY_DRAFT = 'currentCustomDraftPath=';
const CONFIG_KEY_PRESET = 'customPresetPath=';
const SHARED_CLIENT_CONFIG = '.scm/config.json';

const getNodeModules = () => {
  if (typeof window === 'undefined' || !window.require) return null;
  try {
    return {
      fs: window.require('fs'),
      os: window.require('os'),
      path: window.require('path'),
      process: window.require('process'),
    };
  } catch {
    return null;
  }
};

const isDirectory = (fs, filePath) => {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
};

const firstExistingPath = (fs, paths) => {
  for (const filePath of paths) {
    if (filePath && isDirectory(fs, filePath)) {
      return filePath;
    }
  }
  return '';
};

const readJsonFile = (fs, filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
};

const extractSettingValue = (configText, key) => {
  for (const rawLine of configText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith(key)) continue;

    let value = line.slice(key.length).trim();
    if (!value) continue;

    const firstQuote = value.indexOf('"');
    const lastQuote = value.lastIndexOf('"');
    if (firstQuote !== -1 && lastQuote > firstQuote) {
      value = value.slice(firstQuote + 1, lastQuote);
    }

    value = value.replace(/\\\\/g, '\\').trim();
    if (value) return value;
  }
  return '';
};

const expandUserPath = (pathMod, rawValue, home) => {
  if (!rawValue) return '';
  if (rawValue === '~') return home;
  if (rawValue.startsWith('~/') || rawValue.startsWith('~\\')) {
    return pathMod.join(home, rawValue.slice(2).replace(/\\/g, '/'));
  }
  return rawValue;
};

const configValueCandidatePaths = (pathMod, rawValue, home) => {
  const expanded = expandUserPath(pathMod, rawValue, home);
  if (!expanded) return [];
  if (pathMod.basename(expanded) === DRAFT_DIR_NAME) {
    return [expanded];
  }
  return [pathMod.join(expanded, DRAFT_DIR_NAME), expanded];
};

const detectPathFromGlobalSetting = (fs, pathMod, configPaths, home, key, transformCandidates) => {
  for (const configPath of configPaths) {
    try {
      const configText = fs.readFileSync(configPath, 'utf8');
      const rawValue = extractSettingValue(configText, key);
      if (!rawValue) continue;

      const detected = firstExistingPath(fs, transformCandidates(pathMod, rawValue, home));
      if (detected) return detected;
    } catch {}
  }
  return '';
};

const candidateGlobalSettingPathsMac = (pathMod, home) => [
  pathMod.join(home, 'Movies', 'JianyingPro', 'User Data', 'Config', 'globalSetting'),
  pathMod.join(
    home,
    'Library',
    'Containers',
    'com.lemon.lvpro',
    'Data',
    'Documents',
    'JianyingPro',
    'User Data',
    'Config',
    'globalSetting'
  ),
];

const candidateDefaultDraftPathsMac = (pathMod, home) => [
  pathMod.join(home, 'Movies', 'JianyingPro', 'User Data', 'Projects', DRAFT_DIR_NAME),
  pathMod.join(
    home,
    'Library',
    'Containers',
    'com.lemon.lvpro',
    'Data',
    'Documents',
    'JianyingPro',
    'User Data',
    'Projects',
    DRAFT_DIR_NAME
  ),
];

const candidateDefaultPresetPathsMac = (pathMod, home) => [
  pathMod.join(home, 'Movies', 'JianyingPro', 'User Data', 'Presets'),
  pathMod.join(
    home,
    'Library',
    'Containers',
    'com.lemon.lvpro',
    'Data',
    'Movies',
    'JianyingPro',
    'User Data',
    'Presets'
  ),
];

const candidateGlobalSettingPathsWindows = (pathMod, env) => {
  const localAppData = env.LOCALAPPDATA || '';
  if (!localAppData) return [];
  return [pathMod.join(localAppData, 'JianyingPro', 'User Data', 'Config', 'globalSetting')];
};

const candidateDefaultDraftPathsWindows = (pathMod, home, env) => {
  const localAppData = env.LOCALAPPDATA || '';
  const candidates = [];
  if (localAppData) {
    candidates.push(pathMod.join(localAppData, 'JianyingPro', 'User Data', 'Projects', DRAFT_DIR_NAME));
  }
  candidates.push('D:\\JianyingPro Drafts');
  candidates.push(pathMod.join(home, 'Documents', 'JianyingPro Drafts'));
  return candidates;
};

const candidateDefaultPresetPathsWindows = (pathMod, env) => {
  const localAppData = env.LOCALAPPDATA || '';
  if (!localAppData) return [];
  return [pathMod.join(localAppData, 'JianyingPro', 'User Data', 'Presets')];
};

const candidateGuiStorageFiles = (fs, pathMod, env) => {
  const localAppData = env.LOCALAPPDATA || '';
  if (!localAppData) return [];

  const storageDir = pathMod.join(
    localAppData,
    'cn.ai-tools.jyzhushou',
    'EBWebView',
    'Default',
    'Local Storage',
    'leveldb'
  );
  if (!isDirectory(fs, storageDir)) return [];

  try {
    return fs
      .readdirSync(storageDir)
      .map((name) => pathMod.join(storageDir, name))
      .filter((filePath) => {
        const ext = pathMod.extname(filePath).toLowerCase();
        return ['.log', '.ldb'].includes(ext) && fs.statSync(filePath).isFile();
      })
      .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
      .slice(0, 12);
  } catch {
    return [];
  }
};

const detectDraftRootFromGuiStorage = (fs, pathMod, env) => {
  const driveMatches = /"([A-Z]:\\[^"]*(?:Drafts|JianyingPro)[^"]*)"/gi;
  const draftPathMatches = /draft_path[^"]*"([^"]+)"/gi;

  for (const filePath of candidateGuiStorageFiles(fs, pathMod, env)) {
    try {
      const text = fs.readFileSync(filePath).toString('utf8').replace(/\x00/g, ' ');
      const matches = [];

      for (const match of text.matchAll(draftPathMatches)) {
        matches.push(match[1]);
      }
      for (const match of text.matchAll(driveMatches)) {
        matches.push(match[1]);
      }

      for (const rawCandidate of matches) {
        const candidate = rawCandidate.replace(/\\\\/g, '\\');
        if (isDirectory(fs, candidate)) {
          return candidate;
        }
      }
    } catch {}
  }

  return '';
};

const sharedClientConfigPath = (pathMod, home) => pathMod.join(home, SHARED_CLIENT_CONFIG);

const cliConfigPath = (pathMod, platformName, home, env) => {
  if (platformName === 'win32') {
    return pathMod.join(env.APPDATA || home, 'JianyingAssistant', 'config.json');
  }
  return pathMod.join(home, '.jianying-assistant', 'config.json');
};

const loadCliDraftRoot = (fs, pathMod, platformName, home, env, sharedData) => {
  const configData = readJsonFile(fs, cliConfigPath(pathMod, platformName, home, env));
  return String(configData.draft_root || sharedData.draftPath || '').trim();
};

const detectWindowsDraftPath = (fs, pathMod, home, env) => {
  const fromConfig = detectPathFromGlobalSetting(
    fs,
    pathMod,
    candidateGlobalSettingPathsWindows(pathMod, env),
    home,
    CONFIG_KEY_DRAFT,
    configValueCandidatePaths
  );
  if (fromConfig) return fromConfig;

  const sharedData = readJsonFile(fs, sharedClientConfigPath(pathMod, home));
  const cliDraftRoot = loadCliDraftRoot(fs, pathMod, 'win32', home, env, sharedData);
  const candidates = [];

  const guiStoragePath = detectDraftRootFromGuiStorage(fs, pathMod, env);
  if (guiStoragePath) candidates.push(guiStoragePath);

  const sharedDraftPath = String(sharedData.draftPath || '').trim();
  if (sharedDraftPath) {
    candidates.push(expandUserPath(pathMod, sharedDraftPath, home));
  }
  if (cliDraftRoot) {
    candidates.push(expandUserPath(pathMod, cliDraftRoot, home));
  }

  candidates.push(...candidateDefaultDraftPathsWindows(pathMod, home, env));
  const detected = firstExistingPath(fs, candidates);
  if (detected) return detected;

  const localAppData = env.LOCALAPPDATA || '';
  if (!localAppData) return '';
  return pathMod.join(localAppData, 'JianyingPro', 'User Data', 'Projects', DRAFT_DIR_NAME);
};

export const detectJianyingPaths = () => {
  const modules = getNodeModules();
  if (!modules) {
    return { draftPath: '', presetPath: '' };
  }

  const { fs, os, path: pathMod, process: processMod } = modules;
  const home = os.homedir();
  const platformName = os.platform();
  const env = processMod?.env || {};

  const customDraftPath =
    env.JY_CLIENT_DRAFT_PATH || env.JIANYING_DRAFT_ROOT || env.JIANYING_PROJECT_ROOT || '';

  let draftPath = '';
  let presetPath = '';

  if (customDraftPath) {
    draftPath = expandUserPath(pathMod, customDraftPath, home);
  } else if (platformName === 'win32') {
    draftPath = detectWindowsDraftPath(fs, pathMod, home, env);
  } else {
    draftPath =
      detectPathFromGlobalSetting(
        fs,
        pathMod,
        candidateGlobalSettingPathsMac(pathMod, home),
        home,
        CONFIG_KEY_DRAFT,
        configValueCandidatePaths
      ) || firstExistingPath(fs, candidateDefaultDraftPathsMac(pathMod, home));
  }

  if (platformName === 'win32') {
    presetPath =
      detectPathFromGlobalSetting(
        fs,
        pathMod,
        candidateGlobalSettingPathsWindows(pathMod, env),
        home,
        CONFIG_KEY_PRESET,
        (innerPathMod, rawValue, innerHome) => [expandUserPath(innerPathMod, rawValue, innerHome)]
      ) || firstExistingPath(fs, candidateDefaultPresetPathsWindows(pathMod, env));
  } else {
    presetPath =
      detectPathFromGlobalSetting(
        fs,
        pathMod,
        candidateGlobalSettingPathsMac(pathMod, home),
        home,
        CONFIG_KEY_PRESET,
        (innerPathMod, rawValue, innerHome) => [expandUserPath(innerPathMod, rawValue, innerHome)]
      ) || firstExistingPath(fs, candidateDefaultPresetPathsMac(pathMod, home));
  }

  return {
    draftPath: draftPath || '',
    presetPath: presetPath || '',
  };
};
