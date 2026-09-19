import { APP_CONFIG } from '../constants/appConfig.js';
import { logger } from '../utils/logger.js';

export const appsScriptService = {
  /**
   * Wrapper gọi API sang Google Apps Script.
   * Sử dụng 'text/plain;charset=utf-8' để BỎ QUA kiểm tra CORS Preflight (OPTIONS) của trình duyệt.
   */
  async request(action, payload = {}) {
    let endpoint = APP_CONFIG.APPS_SCRIPT_URL;

    if (!endpoint || endpoint.includes('YOUR_APPS_SCRIPT')) {
      throw new Error('Chưa cấu hình APPS_SCRIPT_URL trong APP_CONFIG. Hãy cập nhật URL vào appConfig.js!');
    }

    if (endpoint.endsWith('/dev')) {
      logger.warn('⚠️ Bạn đang dùng URL kết thúc bằng /dev. Hãy đổi thành /exec khi Triển khai (Deploy) để không bị lỗi phân quyền!');
    }

    const bodyData = JSON.stringify({ action, ...payload });

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: bodyData,
        redirect: 'follow'
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Lỗi 404: Không tìm thấy Web App! Kiểm tra lại URL trong appConfig.js hoặc Deploy bản mới trên Apps Script với quyền "Anyone".');
        }
        throw new Error(`Apps Script HTTP Error: ${response.status}`);
      }

      // Đọc response dạng Text trước để tránh crash khi Backend trả về HTML trang lỗi của Google
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
      logger.error(`AppsScript Request Error [${action}]:`, error);
      throw error;
    }
  },

  async submitExamAnswers(examId, studentInfo, answers) {
    return await this.request('SUBMIT_EXAM', { examId, studentInfo, answers });
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

  async callGeminiVisionProxy(prompt, imageBase64, mimeType = 'image/jpeg') {
    return await this.request('GEMINI_PROXY', { prompt, imageBase64, mimeType });
  },

  async authenticateLecturer(username, password) {
    return await this.request('AUTH_LECTURER', { username, password });
  },

  // Bổ sung hàm lấy danh sách đề thi phục vụ cho handleLoadMyExams()
  async getLecturerExams(username) {
    return await this.request('GET_LECTURER_EXAMS', { username });
  }
};
