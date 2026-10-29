import { appsScriptService } from './appsScriptService.js';
import { getLoggedInUsername } from '../modules/authAndCore.js';
import { logger } from '../utils/logger.js';

/**
 * AI EXAM PARSER SERVICE - XỬ LÝ BÓC TÁCH ĐỀ THI BẰNG GEMINI AI
 */
export class AIExamParserService {
  /**
   * Gửi dữ liệu đề thi về Backend Google Apps Script để AI xử lý
   * @param {object} params - { rawText, imageBase64, mimeType, questions, customApiKey }
   * @returns {Promise<object>} { questions, isFallback, message }
   */
  static async parseExamWithAI({ rawText = '', imageBase64 = null, mimeType = 'image/png', questions = [], customApiKey = '' }) {
    const username = getLoggedInUsername();
    
    // Đọc API Key cá nhân lưu trong sessionStorage/localStorage nếu không truyền trực tiếp
    let apiKey = customApiKey;
    if (!apiKey) {
      try {
        const u = JSON.parse(sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser') || '{}');
        apiKey = u.geminiApiKey || '';
      } catch (e) {}
    }

    logger.info(`Bắt đầu gửi đề thi sang Gemini AI Proxy... (User: ${username})`);

    try {
      const response = await appsScriptService.request('PARSE_EXAM_AI', {
        rawText: rawText,
        imageBase64: imageBase64,
        mimeType: mimeType,
        questions: questions,
        customApiKey: apiKey,
        username: username
      });

      if (response && response.questions) {
        logger.info(`Bóc tách AI thành công! Nhận về ${response.questions.length} câu hỏi.`);
        return {
          questions: response.questions,
          isFallback: Boolean(response.isFallback),
          message: response.message || '✅ Đã chuẩn hóa câu hỏi bằng AI thành công!'
        };
      }

      throw new Error('AI không phản hồi cấu trúc dữ liệu câu hỏi hợp lệ.');

    } catch (err) {
      logger.warn(`Lỗi bóc tách AI: ${err.message}. Chuyển sang chế độ Code thuần...`);

      // CHẾ ĐỘ DỰ PHÒNG: Tự chuẩn hóa mảng câu hỏi bằng Code thuần ở Client
      const fallbackQuestions = (questions || []).map((q, idx) => {
        let opts = [...(q.options || [])];
        while (opts.length < 4) opts.push('');

        const origCount = q.originalOptionCount !== undefined ? q.originalOptionCount : opts.filter(o => String(o).trim()).length;
        const isMissingOptions = origCount < 4;
        const isMissingAnswer = q.correctAnswer === null || q.correctAnswer === undefined;

        return {
          id: q.id || `q_${idx + 1}`,
          stem: q.stem || `Câu ${idx + 1}`,
          options: opts.slice(0, 4),
          correctAnswer: isMissingAnswer ? 0 : q.correctAnswer,
          hasImage: Boolean(q.hasImage),
          imageUrl: q.imageUrl || null,
          originalOptionCount: origCount,
          flags: {
            needsUserConfirmation: true,
            isMissingOptions: isMissingOptions,
            isMissingAnswer: isMissingAnswer,
            note: `⚠️ Không kết nối được AI (${err.message}). Đã chuyển sang bóc tách bằng Code thuần.`
          }
        };
      });

      return {
        questions: fallbackQuestions,
        isFallback: true,
        message: `⚠️ Không thể kết nối AI (${err.message}). Đã chuyển sang chế độ Code thuần.`
      };
    }
  }
}

export const aiExamParserService = AIExamParserService;
window.aiExamParserService = AIExamParserService;
