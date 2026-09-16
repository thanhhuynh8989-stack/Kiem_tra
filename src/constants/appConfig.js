/**
 * System Constants & Configuration
 */

export const APP_CONFIG = {
  // Cấu hình kết nối Backend
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

export const REGEX_PATTERNS = {
  // Nhận diện đầu câu hỏi (Ví dụ: "Câu 1:", "Question 12.", "Bài 3:")
  QUESTION_START: /^(?:Câu|Question|Bài)\s*(\d+)[:.]?\s*/i,

  // Nhận diện các lựa chọn đáp án (Ví dụ: "A. ", "B) ", "C: ")
  OPTION_START: /^[A-H][.:)]\s*/,

  // Nhận diện đáp án đúng trong ngoặc hoặc đính kèm
  ANSWER_KEY: /(?:Đáp án|Key|Ans)[:\s]*([A-H])/i,

  // ĐÃ SỬA: Bắt buộc thêm ký tự escape '\$' cho dấu dollar
  LATEX_INLINE: /\$([^$]+)\$/g,
  LATEX_BLOCK: /\$\$([^$]+)\$\$/g
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
