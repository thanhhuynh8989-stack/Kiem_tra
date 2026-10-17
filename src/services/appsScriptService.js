import { APP_CONFIG } from '../constants/appConfig.js';
import { logger } from '../utils/logger.js';

export const appsScriptService = {
  /**
   * Wrapper gọi API sang Google Apps Script với Timeout 300s cho AI.
   */
  async request(action, payload = {}, customTimeout = null) {
    let endpoint = APP_CONFIG.APPS_SCRIPT_URL;

    if (!endpoint || endpoint.includes('YOUR_APPS_SCRIPT')) {
      throw new Error('Chưa cấu hình APPS_SCRIPT_URL trong APP_CONFIG.');
    }

    const bodyData = JSON.stringify({ action, ...payload });

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
        throw new Error(`Thời gian xử lý quá 5 phút. Vui lòng kiểm tra lại file.`);
      }
      if (typeof logger !== 'undefined' && logger.error) {
        logger.error(`AppsScript Request Error [${action}]:`, error);
      }
      throw error;
    }
  },

  async parseExamAI(rawText, imageBase64 = '', mimeType = 'image/png', model = 'gemini-3.6-flash', parsedQuestions = null, customApiKey = '', username = '') {
    return await this.request('PARSE_EXAM_AI', { 
      rawText, 
      imageBase64, 
      mimeType, 
      model, 
      questions: parsedQuestions,
      customApiKey,
      username
    }, 300000);
  },

  async callGeminiVisionProxy(prompt, imageBase64, mimeType = 'image/jpeg', model = 'gemini-3.6-flash') {
    return await this.request('GEMINI_PROXY', { prompt, imageBase64, mimeType, model }, 60000);
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
