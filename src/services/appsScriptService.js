import { APP_CONFIG } from '../constants/appConfig.js';
import { logger } from '../utils/logger.js';

export const appsScriptService = {
  /**
   * Wrapper gọi API sang Google Apps Script với ngắt Timeout chống treo nút
   */
  async request(action, payload = {}) {
    let endpoint = APP_CONFIG.APPS_SCRIPT_URL;

    if (!endpoint || endpoint.includes('YOUR_APPS_SCRIPT')) {
      throw new Error('Chưa cấu hình APPS_SCRIPT_URL trong APP_CONFIG. Hãy cập nhật URL trong appConfig.js!');
    }

    if (endpoint.endsWith('/dev')) {
      if (typeof logger !== 'undefined') {
        logger.warn('⚠️ Bạn đang dùng URL kết thúc bằng /dev. Hãy đổi thành /exec khi Deploy!');
      }
    }

    const bodyData = JSON.stringify({ action, ...payload });

    // Tạo bộ đếm thời gian Timeout 12 giây
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

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
        throw new Error('Backend trả về phản hồi không hợp lệ (không phải JSON). Vui lòng kiểm tra lại Deploy trên Apps Script.');
      }

      if (result.status === 'error') {
        throw new Error(result.message || 'Lỗi xử lý tại Server Backend');
      }

      return result;

    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Kết nối Máy chủ quá thời gian (Timeout 12s). Vui lòng kiểm tra lại mạng!');
      }
      if (typeof logger !== 'undefined') {
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
    });
  },

  async callGeminiVisionProxy(prompt, imageBase64, mimeType = 'image/jpeg', model = 'gemini-3.6-flash') {
    return await this.request('GEMINI_PROXY', { prompt, imageBase64, mimeType, model });
  },

  async authenticateLecturer(username, password) {
    return await this.request('AUTH_LECTURER', { username, password });
  },

  async getLecturerExams(username) {
    return await this.request('GET_MY_EXAMS', { username });
  },

  async parseExamAI(rawText, imageBase64 = '', mimeType = 'image/png', model = 'gemini-3.6-flash') {
    return await this.request('PARSE_EXAM_AI', { rawText, imageBase64, mimeType, model });
  }
};
