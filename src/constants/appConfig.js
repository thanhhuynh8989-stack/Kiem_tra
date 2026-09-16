/**
 * System Constants & Configuration
 */

export const APP_CONFIG = {
  // Cấu hình kết nối Backend Google Apps Script
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxb4Tb3_B2F7_Qywy9rSaNYaYcfzDmTZTfALSrSB4JXW9pfc289BjEZ7xR4M2DKjvLx/exec',
  
  // Cấu hình GitHub CDN / Public Exam Repository
  GITHUB: {
    OWNER: 'thanhhuynh8989-stack',
    REPO: 'Kiem_tra',
    BRANCH: 'main'
  },

  // Giới hạn xử lý File và Hình ảnh
  MAX_FILE_SIZE_MB: 15,
  MAX_FILE_SIZE_BYTES: 15 * 1024 * 1024,
  MAX_IMAGE_WIDTH: 1024,
  MAX_IMAGE_HEIGHT: 1024,
  IMAGE_JPEG_QUALITY: 0.75,

  // Xử lý song song & Thử lại khi gọi API
  BATCH_PROCESS_SIZE: 3,
  MAX_RETRY_ATTEMPTS: 3,
  INITIAL_RETRY_DELAY_MS: 1000,

  // Hệ thống Logger
  LOG_MAX_ENTRIES: 100
};

// Sử dụng new RegExp() để chống lỗi cú pháp Regex trên trình duyệt
export const REGEX_PATTERNS = {
  QUESTION_START: new RegExp('^(?:Câu|Question|Bài)\\s*(\\d+)[:.]?\\s*', 'i'),
  OPTION_START: new RegExp('^[A-H][.:)]\\s*'),
  ANSWER_KEY: new RegExp('(?:Đáp án|Key|Ans)[:\\s]*([A-H])', 'i'),
  LATEX_INLINE: new RegExp('\\$([^$]+)\\$', 'g'),
  LATEX_BLOCK: new RegExp('\\$\\$([^$]+)\\$\\$', 'g')
};

export const USER_ROLES = {
  ADMIN: 'ADMIN',
  LECTURER: 'LECTURER',
  STUDENT: 'STUDENT'
};

export const EXAM_STATUS = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED'
};

export const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};
