import { appsScriptService } from './appsScriptService.js';
import { logger } from '../utils/logger.js';

/**
 * Service xử lý phân tích đề thi bằng AI thông qua Apps Script Backend Proxy.
 */
export class AIExamParserService {
  /**
   * Gửi văn bản đề thi thô lên Server Apps Script để Gemini AI phân tích, bổ sung đáp án và gắn cờ kiểm duyệt.
   * @param {string} rawExamText - Nội dung đề thi dạng chuỗi (từ Docx, PDF, TXT)
   * @returns {Promise<{questions: Array}>} Danh sách câu hỏi đã cấu trúc hóa kèm cờ xác minh
   */
  async parseAndEnrichExam(rawExamText) {
    if (!rawExamText || !rawExamText.trim()) {
      throw new Error('Nội dung đề thi đầu vào không được để trống.');
    }

    try {
      logger.info('Đang gửi dữ liệu đề thi sang Apps Script Backend để phân tích qua Gemini AI...');

      // Gửi action PARSE_EXAM_AI kèm văn bản thô tới Apps Script
      const response = await appsScriptService.request('PARSE_EXAM_AI', {
        rawText: rawExamText
      });

      // Kiểm tra phản hồi lỗi từ Apps Script Backend
      if (response.status === 'error') {
        throw new Error(response.message || 'Lỗi xử lý phân tích đề thi từ Server Apps Script.');
      }

      const parsedData = response.data;

      // Kiểm tra cấu trúc dữ liệu trả về từ AI
      if (!parsedData || !Array.isArray(parsedData.questions)) {
        throw new Error('Dữ liệu AI trả về không đúng định dạng cấu trúc câu hỏi.');
      }

      logger.info(`Đã phân tích thành công ${parsedData.questions.length} câu hỏi.`);
      return parsedData;

    } catch (error) {
      logger.error('Lỗi trong quá trình AI phân tích đề thi:', error);
      throw error;
    }
  }
}

// Export Singleton instance và Class
export const aiExamParserService = new AIExamParserService();
export default aiExamParserService;
