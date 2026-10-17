import { APP_CONFIG } from '../constants/appConfig.js';
import { logger } from '../utils/logger.js';

export const appsScriptService = {
  /**
   * Wrapper gọi API sang Google Apps Script với Timeout linh hoạt theo tác vụ.
   */
  async request(action, payload = {}, customTimeout = null) {
    let endpoint = APP_CONFIG.APPS_SCRIPT_URL;

    if (!endpoint || endpoint.includes('YOUR_APPS_SCRIPT')) {
      throw new Error('Chưa cấu hình APPS_SCRIPT_URL trong APP_CONFIG. Hãy cập nhật URL vào appConfig.js!');
    }

    const bodyData = JSON.stringify({ action, ...payload });

    // Tự động nâng Timeout lên 60 giây đối với các tác vụ xử lý AI nặng
    const isAITask = ['PARSE_EXAM_AI', 'GEMINI_PROXY', 'SAVE_AND_PUBLISH_EXAM'].includes(action);
    const timeoutMs = customTimeout || (isAITask ? 60000 : 15000); 

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: bodyData,
        redirect: 'follow',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Lỗi 404: Không tìm thấy Web App! Hãy Deploy bản mới trên Apps Script với quyền "Anyone".');
        }
        throw new Error(`Apps Script HTTP Error: ${response.status}`);
      }

      const rawText = await response.text();
      let result;
      try {
        result = JSON.parse(rawText);
      } catch (parseError) {
        throw new Error('Backend trả về phản hồi không phải JSON hợp lệ. Kiểm tra lại kết quả xuất bản Apps Script.');
      }

      if (result.status === 'error') {
        throw new Error(result.message || 'Lỗi xử lý tại Server Backend');
      }

      return result;

    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`AI đang bóc tách nhiều dữ liệu vượt quá ${timeoutMs / 1000}s. Vui lòng bấm "Phân Tích Đề Bằng AI" thử lại lần nữa!`);
      }
      if (typeof logger !== 'undefined' && logger.error) {
        logger.error(`AppsScript Request Error [${action}]:`, error);
      }
      throw error;
    }
  },

  async submitExamAnswers(examId, studentInfo, answers, violationInfo = {}) {
    return await this.request('SUBMIT_EXAM', { examId, studentInfo, answers, violationInfo });
  },

  async saveAndPublishExam(examId, masterKey, publicExamData, filePath, username) {
    return await this.request('SAVE_AND_PUBLISH_EXAM', {
      examId,
      masterKey,
      publicExamData,
      filePath,
      username
    }, 45000);
  },

  async callGeminiVisionProxy(prompt, imageBase64, mimeType = 'image/jpeg', model = 'gemini-1.5-flash') {
    return await this.request('GEMINI_PROXY', { prompt, imageBase64, mimeType, model }, 60000);
  },

  async authenticateLecturer(username, password) {
    return await this.request('AUTH_LECTURER', { username, password });
  },

  async getLecturerExams(username) {
    return await this.request('GET_MY_EXAMS', { username });
  },

  async parseExamAI(rawText, imageBase64 = '', mimeType = 'image/png', model = 'gemini-1.5-flash') {
    return await this.request('PARSE_EXAM_AI', { rawText, imageBase64, mimeType, model }, 60000);
  }
};
