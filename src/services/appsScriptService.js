import { APP_CONFIG } from '../constants/appConfig.js';
import { getLoggedInUsername, getLoggedInRole } from '../modules/authAndCore.js';

/**
 * APPS SCRIPT SERVICE - CẦU NỐI KẾT NỐI VỚI GOOGLE APPS SCRIPT BACKEND
 */
class AppsScriptService {
  constructor() {
    this.scriptUrl = APP_CONFIG?.APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbyTDHy_MRROk1uN6Zz8BZu1Ulq-7L0zjDaZ85GukK4JKTwuR_GuTHkssqeeYyTlpnRR/exec';
  }

  /**
   * Gửi HTTP POST request an toàn về Backend Google Apps Script
   * @param {string} action - Tên thao tác (VD: 'LOGIN', 'SUBMIT_EXAM', 'GET_STUDENTS')
   * @param {object} payloadData - Dữ liệu kèm theo
   * @returns {Promise<object>} JSON phản hồi từ Server
   */
  async request(action, payloadData = {}) {
    if (!action) {
      throw new Error('Thiếu tham số action trong AppsScriptService.');
    }

    // Tự động đính kèm thông tin Người dùng & Role hiện tại vào mọi Request
    const currentUsername = getLoggedInUsername();
    const currentRole = getLoggedInRole();

    const fullPayload = {
      action: action,
      username: payloadData.username || payloadData.studentCode || currentUsername,
      studentCode: payloadData.studentCode || payloadData.username || currentUsername,
      role: payloadData.role || currentRole,
      data: payloadData,
      ...payloadData
    };

    let attempts = 0;
    const maxAttempts = APP_CONFIG?.MAX_RETRY_ATTEMPTS || 3;
    let lastError = null;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const response = await fetch(this.scriptUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8' // Đảm bảo không bị dính lỗi CORS Preflight
          },
          body: JSON.stringify(fullPayload)
        });

        if (!response.ok) {
          throw new Error(`Lỗi HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        if (result && result.status === 'error') {
          throw new Error(result.message || 'Xảy ra lỗi xử lý từ phía Server Google Apps Script');
        }

        return result;
      } catch (err) {
        lastError = err;
        console.warn(`[AppsScriptService] Lần thử ${attempts}/${maxAttempts} cho action "${action}" thất bại:`, err.message);

        if (attempts < maxAttempts) {
          const delay = Math.pow(2, attempts) * 500;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`Không thể kết nối đến Máy chủ sau ${maxAttempts} lần thử. Lỗi chi tiết: ${lastError?.message || 'Lỗi không xác định'}`);
  }

  /**
   * Shortcut gọi bóc tách đề thi bằng AI
   */
  async parseExamAI(data) {
    return this.request('PARSE_EXAM_AI', data);
  }

  /**
   * Shortcut lưu API Key cá nhân của người dùng
   */
  async saveUserApiKey(username, apiKey) {
    return this.request('SAVE_USER_API_KEY', { username, apiKey });
  }
}

export const appsScriptService = new AppsScriptService();
window.appsScriptService = appsScriptService;
