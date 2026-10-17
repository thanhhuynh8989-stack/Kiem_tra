import { APP_CONFIG } from '../constants/appConfig.js';
import { logger } from '../utils/logger.js';

export const appsScriptService = {
  /**
   * Wrapper gọi API sang Google Apps Script.
   * Tác vụ AI sẽ có thời gian chờ 300 giây (5 phút) - thoải mái cho Gemini xử lý đề lớn.
   */
  async request(action, payload = {}, customTimeout = null) {
    let endpoint = APP_CONFIG.APPS_SCRIPT_URL;

    if (!endpoint || endpoint.includes('YOUR_APPS_SCRIPT')) {
      throw new Error('Chưa cấu hình APPS_SCRIPT_URL trong APP_CONFIG.');
    }

    const bodyData = JSON.stringify({ action, ...payload });

    // Tác vụ AI cho phép chờ tối đa 5 phút (300.000ms), các tác vụ khác chờ 20 giây
    const isAITask = ['PARSE_EXAM_AI', 'GEMINI_PROXY', 'SAVE_AND_PUBLISH_EXAM'].includes(action);
    const timeoutMs = customTimeout || (isAITask ? 300000 : 20000); 

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: bodyData,
        redirect: 'follow',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Apps Script HTTP Error: ${response.status}`);
      }

      const rawText = await response.text();
      let result;
      try {
        result = JSON.parse(rawText);
      } catch (parseError) {
        throw new Error('Backend trả về phản hồi không hợp lệ.');
      }

      if (result.status === 'error') {
        throw new Error(result.message || 'Lỗi xử lý tại Server Backend');
      }

      return result;

    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Thời gian xử lý quá 5 phút. Vui lòng kiểm tra lại file hoặc chia nhỏ đề thi.`);
      }
      if (typeof logger !== 'undefined' && logger.error) {
        logger.error(`AppsScript Request Error [${action}]:`, error);
      }
      throw error;
    }
  },

  async parseExamAI(rawText, imageBase64 = '', mimeType = 'image/png', model = 'gemini-1.5-flash') {
    return await this.request('PARSE_EXAM_AI', { rawText, imageBase64, mimeType, model }, 300000);
  },

  async submitExamAnswers(examId, studentInfo, answers, violationInfo = {}) {
    return await this.request('SUBMIT_EXAM', { examId, studentInfo, answers, violationInfo });
  },

  async saveAndPublishExam(examId, masterKey, publicExamData, filePath, username) {
    return await this.request('SAVE_AND_PUBLISH_EXAM', { examId, masterKey, publicExamData, filePath, username }, 60000);
  },

  async authenticateLecturer(username, password) {
    return await this.request('AUTH_LECTURER', { username, password });
  },

  async getLecturerExams(username) {
    return await this.request('GET_MY_EXAMS', { username });
  }
};
