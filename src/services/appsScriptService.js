import { APP_CONFIG } from '../constants/appConfig.js';
import { logger } from '../utils/logger.js';

export const appsScriptService = {
  /**
   * Wrapper gọi API sang Google Apps Script.
   * Sử dụng 'text/plain;charset=utf-8' để BỎ QUA kiểm tra CORS Preflight (OPTIONS) của trình duyệt.
   */
  async request(action, payload = {}) {
    const endpoint = APP_CONFIG.APPS_SCRIPT_URL;
    if (!endpoint) {
      throw new Error('Chưa cấu hình APPS_SCRIPT_URL trong APP_CONFIG');
    }

    const bodyData = JSON.stringify({ action, ...payload });

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: bodyData
      });

      if (!response.ok) {
        throw new Error(`Apps Script HTTP Error: ${response.status}`);
      }

      const result = await response.json();
      if (result.status === 'error') {
        throw new Error(result.message || 'Lỗi xử lý tại Server Backend');
      }

      return result;
    } catch (error) {
      logger.error(`AppsScript Request Error [${action}]:`, error);
      throw error;
    }
  },

  async submitExamAnswers(examId, studentInfo, answers) {
    return await this.request('SUBMIT_EXAM', { examId, studentInfo, answers });
  },

  async saveAndPublishExam(examId, masterKey, publicExamData, filePath) {
    return await this.request('SAVE_AND_PUBLISH_EXAM', {
      examId,
      masterKey,
      publicExamData,
      filePath
    });
  },

  async callGeminiVisionProxy(prompt, imageBase64, mimeType = 'image/jpeg') {
    return await this.request('GEMINI_PROXY', { prompt, imageBase64, mimeType });
  },

  async authenticateLecturer(username, password) {
    return await this.request('AUTH_LECTURER', { username, password });
  }
};
