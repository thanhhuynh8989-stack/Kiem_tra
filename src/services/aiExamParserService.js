import { geminiService } from './geminiService.js';
import { logger } from '../utils/logger.js';

/**
 * Service xử lý phân tích đề thi bằng AI: bóc tách, bổ sung phương án và gán cờ xác nhận.
 */
export class AIExamParserService {
  /**
   * Phân tích văn bản đề thi thô, chuẩn hóa 4 đáp án, tự suy luận đáp án thiếu và gắn cờ kiểm duyệt.
   * @param {string} rawExamText - Nội dung đề thi dạng chuỗi (từ Docx, PDF, TXT)
   * @returns {Promise<{questions: Array}>} Danh sách câu hỏi đã cấu trúc hóa kèm cờ xác minh
   */
  async parseAndEnrichExam(rawExamText) {
    if (!rawExamText || !rawExamText.trim()) {
      throw new Error('Nội dung đề thi đầu vào không được để trống.');
    }

    const prompt = `
Bạn là một chuyên gia khảo thí và xử lý dữ liệu đề thi trắc nghiệm.
Hãy phân tích đoạn văn bản đề thi thô dưới đây và chuẩn hóa thành định dạng JSON theo các quy tắc nghiêm ngặt sau:

--- QUY TẮC BẮC BUỘC ---
1. TÁCH NỘI DUNG:
   - "stem": Nội dung câu hỏi (không chứa các nhãn "Câu 1:", "Câu 2:").
   - "options": Mảng đúng 4 phương án (loại bỏ tiền tố "A.", "B.", "C.", "D." ở đầu mỗi lựa chọn).

2. BỔ SUNG ĐÁP ÁN (NẾU THIẾU):
   - Mỗi câu hỏi BẮC BUỘC phải có đúng 4 phương án.
   - Nếu câu hỏi gốc có ít hơn 4 đáp án, hãy TỰ SINH THÊM các phương án nhiễu hợp lý, sát thực tế để tròn đủ 4 phương án.
   - Đánh dấu: "aiAddedOptions": true.

3. ĐÁNH DẤU ĐÁP ÁN ĐÚNG:
   - "correctAnswer": Chỉ số phương án đúng (0 cho A, 1 cho B, 2 cho C, 3 cho D).
   - Tự động nhận diện đáp án sẵn có qua gạch chân, in đậm, hoặc đáp án ghi ở cuối câu.
   - Nếu đề gốc KHÔNG ĐÁNH DẤU đáp án đúng, hãy TỰ GIẢI CÂU HỎI để tìm đáp án chính xác nhất.
   - Đánh dấu: "aiSuggestedAnswer": true.

4. CỜ XÁC NHẬN BỞI USER (needsUserConfirmation):
   - Đặt "needsUserConfirmation": true NẾU ("aiAddedOptions" === true HOẶC "aiSuggestedAnswer" === true).
   - Đặt "needsUserConfirmation": false nếu đề gốc đã đầy đủ 4 đáp án và đáp án đúng rõ ràng.

--- ĐỊNH DẠNG JSON ĐẦU RA (Chỉ trả về duy nhất JSON, không kèm văn bản giải thích) ---
{
  "questions": [
    {
      "id": "q_1",
      "stem": "Nội dung câu hỏi?",
      "options": ["Phương án 1", "Phương án 2", "Phương án 3", "Phương án 4"],
      "correctAnswer": 0,
      "explanation": "Giải thích chi tiết đáp án...",
      "flags": {
        "aiAddedOptions": true,
        "aiSuggestedAnswer": true,
        "needsUserConfirmation": true,
        "note": "AI đã bổ sung phương án cho đủ 4 đáp án và tự suy luận đáp án đúng."
      }
    }
  ]
}

--- NỘI DUNG ĐỀ THI THÔ ---
${rawExamText}
`;

    try {
      logger.info('Đang gửi dữ liệu đề thi sang Gemini AI để phân tích và bổ sung...');
      const responseText = await geminiService.generateContent(prompt);

      // Trích xuất khối JSON từ phản hồi của AI
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('AI không trả về đúng định dạng JSON.');
      }

      const parsedData = JSON.parse(jsonMatch[0]);
      
      logger.info(`Đã phân tích xong ${parsedData.questions?.length || 0} câu hỏi.`);
      return parsedData;
    } catch (error) {
      logger.error('Lỗi trong quá trình AI phân tích đề thi:', error);
      throw error;
    }
  }
}

export const aiExamParserService = new AIExamParserService();
export default aiExamParserService;
