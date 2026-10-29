import { APP_CONFIG } from '../constants/appConfig.js';
import { ExamModel } from '../models/examModel.js';
import { logger } from '../utils/logger.js';

export class AiExamParserService {
  constructor() {
    this.apiKey = APP_CONFIG?.GEMINI_API_KEY || '';
    // Danh sách các phiên bản Gemini AI thử nghiệm tuần tự để tránh hạn chế / Rate Limit
    this.candidateModels = [
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-1.5-pro',
      'gemini-2.0-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.6-flash',
      'gemini-3.7-flash'
    ];
  }

async parseExamWithAI({ questions = [] }) {
    // 1. Lấy Gemini API Key từ bộ nhớ
    let activeKey = this.apiKey;
    try {
      const u = JSON.parse(sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser') || '{}');
      if (u.geminiApiKey) activeKey = u.geminiApiKey.trim();
    } catch (e) {}

    // 2. Yêu cầu nhập API Key nếu chưa phát hiện
    if (!activeKey) {
      activeKey = prompt('🔑 Vui lòng nhập Gemini API Key hợp lệ (bắt đầu bằng AIzaSy...):');
      if (!activeKey || !activeKey.trim()) {
        return {
          success: false,
          message: '⚠️ Chưa nhập Gemini API Key. Thao tác phân tích AI đã bị hủy.'
        };
      }
      activeKey = activeKey.trim();
    }

    const systemPrompt = `
You are an expert AI educational assistant. 
Your task is to review, complete, and correct a multiple-choice exam questionnaire.

STRICT INSTRUCTIONS:
1. REVIEW QUESTIONS: Look at each question stem and its options.
2. FILL MISSING OPTIONS: If any option (A, B, C, D) is blank, empty, missing, or contains generic placeholders like "Phương án C...", "Phương án D...", YOU MUST GENERATE A FACTUALLY ACCURATE AND PLAUSIBLE OPTION text related to the question topic. NEVER leave options empty or with placeholder text.
3. DETERMINE CORRECT ANSWER: Analyze the stem and the 4 options carefully. Select the EXACT correct answer index (0 for A, 1 for B, 2 for C, 3 for D).
4. FORMAT OUTPUT: Return strictly a raw JSON array of objects without markdown formatting or backticks (\`\`\`json).

JSON Output Structure:
[
  {
    "id": "q_1",
    "stem": "Nội dung câu hỏi...",
    "options": ["Phương án A", "Phương án B", "Phương án C sinh bởi AI", "Phương án D sinh bởi AI"],
    "correctAnswer": 1
  }
]
`;

    let lastErrorMessage = '';

    // 3. VÒNG LẶP THỬ TUẦN TỰ TỪNG PHIÊN BẢN GEMINI
    for (const modelName of this.candidateModels) {
      logger.info(`🤖 Đang kết nối phân tích qua mô hình Gemini: [${modelName}]...`);

      const payloadContents = [{
        role: 'user',
        parts: [
          { text: systemPrompt },
          { text: `Danh sách câu hỏi cần hoàn thiện:\n${JSON.stringify(questions, null, 2)}` }
        ]
      }];

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${activeKey}`;

      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: payloadContents })
        });

        // Xử lý khi API Key lỗi / hết hạn (401/403)
        if (response.status === 401 || response.status === 403) {
          const newKey = prompt('⚠️ Gemini API Key hiện tại không hợp lệ hoặc bị khóa (Lỗi 401/403).\nVui lòng dán Gemini API Key chuẩn từ Google AI Studio (bắt đầu bằng AIzaSy...):');
          if (newKey && newKey.trim()) {
            activeKey = newKey.trim();
            try {
              const u = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
              u.geminiApiKey = activeKey;
              sessionStorage.setItem('currentUser', JSON.stringify(u));
            } catch (e) {}
            return this.parseExamWithAI({ questions });
          } else {
            return {
              success: false,
              message: '⚠️ API Key không hợp lệ. Vui lòng lấy Key mới tại https://aistudio.google.com/'
            };
          }
        }

        // Bỏ qua nếu phiên bản mô hình không khả dụng hoặc bị Rate Limit
        if (!response.ok) {
          const errText = await response.text();
          lastErrorMessage = `HTTP ${response.status} (${modelName})`;
          logger.warn(`⚠️ Mô hình [${modelName}] gặp sự cố (${response.status}). Đang tự động chuyển mô hình tiếp theo...`, errText);
          continue; 
        }

        const resData = await response.json();
        const rawResponseText = resData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const cleanJsonStr = rawResponseText.replace(/```json/gi, '').replace(/```/g, '').trim();
        const parsedArray = JSON.parse(cleanJsonStr);

        if (!Array.isArray(parsedArray) || parsedArray.length === 0) {
          throw new Error('Dữ liệu AI trả về không phải là mảng JSON hợp lệ.');
        }

        // 4. CƠ CHẾ ĐỐI SOÁT DỮ LIỆU: CHỈ GẮN CỜ CHO CÂU HỎI THỰC SỰ BỊ CHỈNH SỬA
        const refinedQuestions = parsedArray.map((aiQ, idx) => {
          const normalized = ExamModel.normalizeQuestion(aiQ, idx);
          const origQ = questions[idx] || {};

          const isModified = checkIfQuestionModified(origQ, normalized);

          normalized.flags = {
            needsUserConfirmation: isModified, // Chỉ bằng true nếu AI thực sự tác động
            note: isModified
              ? `🤖 AI (${modelName}) đã sinh bổ sung phương án/đáp án. Giảng viên vui lòng rà soát lại.`
              : `✅ Giữ nguyên từ bản gốc, AI không tác động.`
          };

          return normalized;
        });

        logger.info(`🎉 Phân tích hoàn tất thành công qua mô hình Gemini: [${modelName}]`);
        return {
          success: true,
          message: `🎉 Phân tích hoàn tất! Đã phân loại và chỉ gắn cờ cảnh báo đối với các câu hỏi có tác động bởi AI.`,
          questions: refinedQuestions
        };

      } catch (err) {
        lastErrorMessage = err.message;
        logger.warn(`⚠️ Mô hình [${modelName}] báo lỗi: ${err.message}. Đang thử mô hình tiếp theo...`);
      }
    }

    return {
      success: false,
      message: `⚠️ Tất cả mô hình Gemini đều quá tải hoặc gặp sự cố: ${lastErrorMessage}`
    };
  }
}

/**
 * HÀM KIỂM TRA ĐỐI SOÁT DỮ LIỆU (DIFFING)
 * Trả về true nếu AI có tác động chỉnh sửa/bổ sung câu hỏi
 */
function checkIfQuestionModified(origQ, aiQ) {
  if (!origQ || !aiQ) return true;

  // 1. Kiểm tra nội dung câu hỏi (Stem)
  const origStem = (origQ.stem || '').trim();
  const aiStem = (aiQ.stem || '').trim();
  if (origStem !== aiStem) return true;

  // 2. Kiểm tra chỉ số đáp án đúng (Correct Answer)
  if (origQ.correctAnswer !== aiQ.correctAnswer) return true;

  // 3. Kiểm tra các phương án lựa chọn (Options)
  const origOpts = origQ.options || [];
  const aiOpts = aiQ.options || [];

  if (origOpts.length !== aiOpts.length) return true;

  for (let i = 0; i < origOpts.length; i++) {
    const oText = (origOpts[i] || '').trim();
    const aText = (aiOpts[i] || '').trim();

    // Phát hiện phương án bị AI thay đổi nội dung
    if (oText !== aText) return true;

    // Phát hiện trường hợp bản gốc từng chứa chữ giữ chỗ "Phương án C..." nay đã được điền
    if (!oText || oText.includes('Phương án C...') || oText.includes('Phương án D...') || oText === '...') {
      return true;
    }
  }

  return false; // Trả về false nếu câu hỏi hoàn toàn giống hệt bản gốc
}

export const aiExamParserService = new AiExamParserService();
window.aiExamParserService = aiExamParserService;

export const aiExamParserService = new AiExamParserService();
window.aiExamParserService = aiExamParserService;
