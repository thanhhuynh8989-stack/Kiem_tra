import { appsScriptService } from './appsScriptService.js';
import { logger } from '../utils/logger.js';
import { getConfig } from '../modules/config.js';

/**
 * Service xử lý phân tích đề thi bằng AI thông qua Apps Script Backend Proxy.
 */
export class AIExamParserService {
  /**
   * Gửi văn bản đề thi thô hoặc ảnh lên Server Apps Script để Gemini AI phân tích.
   * @param {string} rawExamText - Nội dung đề thi dạng chuỗi (từ Docx, PDF, TXT)
   * @param {string} [imageBase64=''] - Dữ liệu ảnh Base64 (nếu có)
   * @param {string} [mimeType='image/png'] - Loại định dạng ảnh
   * @returns {Promise<{questions: Array}>} Danh sách câu hỏi đã cấu trúc hóa
   */
  async parseAndEnrichExam(rawExamText, imageBase64 = '', mimeType = 'image/png') {
    if ((!rawExamText || !rawExamText.trim()) && !imageBase64) {
      throw new Error('Nội dung đề thi đầu vào không được để trống.');
    }

    try {
      // Lấy tên model người dùng đã cấu hình trong giao diện Admin
      const config = getConfig();
      const selectedModel = config.geminiModel || 'gemini-3.6-flash';

      logger.info(`Đang gửi dữ liệu đề thi sang Apps Script Backend (Model: ${selectedModel})...`);

      // Gửi action PARSE_EXAM_AI kèm tham số model, imageBase64, mimeType sang Backend
      const response = await appsScriptService.request('PARSE_EXAM_AI', {
        rawText: rawExamText || '',
        imageBase64: imageBase64 || '',
        mimeType: mimeType || 'image/png',
        model: selectedModel
      });

      if (response.status === 'error') {
        throw new Error(response.message || 'Lỗi xử lý phân tích đề thi từ Server Apps Script.');
      }

      const parsedData = response.data;

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
