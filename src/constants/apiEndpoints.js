import { APP_CONFIG } from './appConfig.js';

const githubOwner = APP_CONFIG?.GITHUB?.OWNER || '';
const githubRepo = APP_CONFIG?.GITHUB?.REPO || '';
const githubBranch = APP_CONFIG?.GITHUB?.BRANCH || 'main';

export const API_ENDPOINTS = {
  GITHUB: {
    BASE_URL: 'https://api.github.com',
    RAW_BASE_URL: `https://raw.githubusercontent.com/${githubOwner}/${githubRepo}/${githubBranch}`,
    EXAMS_DIR: 'exams',
    KEYS_DIR: 'keys'
  },
  GEMINI: {
    BASE_URL: 'https://generativelanguage.googleapis.com/v1beta',
    DEFAULT_MODEL: 'gemini-3.6-flash'
  },
  APPS_SCRIPT: APP_CONFIG?.APPS_SCRIPT_URL || ''
};
