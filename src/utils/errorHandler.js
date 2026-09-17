import { APP_CONFIG } from '../constants/appConfig.js';
import { logger } from './logger.js';

export class AppError extends Error {
  constructor(message, code = 'GENERIC_ERROR', details = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Executes an async function with exponential backoff retry mechanism.
 * Essential for API requests to Gemini/GitHub prone to rate limits (HTTP 429).
 */
export async function fetchWithRetry(
  fn,
  maxRetries = (APP_CONFIG && APP_CONFIG.MAX_RETRY_ATTEMPTS) || 3,
  delayMs = (APP_CONFIG && APP_CONFIG.INITIAL_RETRY_DELAY_MS) || 1000
) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      logger.warn(`Lần thử ${attempt}/${maxRetries} thất bại. Lỗi: ${error.message}`);

      if (attempt === maxRetries) break;

      // Exponential backoff với jitter ngẫu nhiên
      const backoffTime = delayMs * Math.pow(2, attempt - 1) + Math.random() * 200;
      logger.info(`Chờ ${Math.round(backoffTime)}ms trước khi thử lại...`);
      await new Promise((resolve) => setTimeout(resolve, backoffTime));
    }
  }

  logger.error(`Tất cả ${maxRetries} lần thử đều thất bại.`);
  throw new AppError(
    `Thao tác thất bại sau ${maxRetries} lần thử: ${lastError ? lastError.message : 'Unknown error'}`,
    'RETRY_EXHAUSTED',
    lastError
  );
}

/**
 * Safe async function wrapper to prevent unhandled promise rejections.
 */
export async function safeAsync(fn, fallbackValue = null) {
  try {
    return await fn();
  } catch (error) {
    logger.error('Xảy ra lỗi trong khối safeAsync:', error);
    return fallbackValue;
  }
}
