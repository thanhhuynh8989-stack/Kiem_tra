/

System Constants & Configuration
*/

export const APP_CONFIG = {
MAX_FILE_SIZE_MB: 15,
MAX_FILE_SIZE_BYTES: 15 * 1024 * 1024,
MAX_IMAGE_WIDTH: 1024,
MAX_IMAGE_HEIGHT: 1024,
IMAGE_JPEG_QUALITY: 0.75,
BATCH_PROCESS_SIZE: 3,
MAX_RETRY_ATTEMPTS: 3,
INITIAL_RETRY_DELAY_MS: 1000,
LOG_MAX_ENTRIES: 100
};

export const REGEX_PATTERNS = {
// Nhận diện đầu câu hỏi (Ví dụ: "Câu 1:", "Question 12.", "Bài 3:")
QUESTION_START: /^(?:Câu|Question|Bài)\s*(\d+)[:.]?\s*/i,

// Nhận diện các lựa chọn đáp án (Ví dụ: "A. ", "B) ", "C: ")
OPTION_START: /^[A-H][.:)]\s*/,

// Nhận diện đáp án đúng trong ngoặc hoặc đính kèm
ANSWER_KEY: /(?:Đáp án|Key|Ans)[:\s]*([A-H])/i,

// Nhận diện công thức LaTeX dạng inline $...$ hoặc block 

$$...$$


LATEX_INLINE: /$([^$]+)$/g,
LATEX_BLOCK: /$$([^$]+)$$/g
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
