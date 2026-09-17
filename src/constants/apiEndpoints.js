import { APP_CONFIG } from './appConfig.js';

/**
 * API Endpoints Configuration
 */

export const API_ENDPOINTS = {
  GITHUB: {
    BASE_URL: 'https://api.github.com',
    RAW_BASE_URL: `https://raw.githubusercontent.com/${APP_CONFIG.GITHUB.OWNER}/${APP_CONFIG.GITHUB.REPO}/${APP_CONFIG.GITHUB.BRANCH}`,
    EXAMS_DIR: 'exams',
    KEYS_DIR: 'keys'
  },
  GEMINI: {
    BASE_URL: 'https://generativelanguage.googleapis.com/v1beta',
    DEFAULT_MODEL: 'gemini-1.5-flash'
  },
  APPS_SCRIPT: APP_CONFIG.APPS_SCRIPT_URL
};
