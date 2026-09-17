import { APP_CONFIG, EXAM_STATUS } from '../constants/appConfig.js';
import { logger } from '../utils/logger.js';

/**
 * Model quản lý cấu trúc dữ liệu đề thi, tách đáp án và xử lý trộn câu hỏi.
 */
export class ExamModel {
  /**
   * Tạo chuỗi UUID v4 duy nhất cho đề thi hoặc câu hỏi.
   * @returns {string} Chuỗi UUID
   */
  static generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback thủ công nếu trình duyệt không hỗ trợ crypto.randomUUID
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Chuẩn hóa và làm sạch văn bản HTML / KaTeX.
   * @param {string} text - Văn bản cần làm sạch
   * @returns {string} Văn bản đã chuẩn hóa
   */
  static sanitizeContent(text) {
    if (!text || typeof text !== 'string') return '';
    
    return text
      .trim()
      .replace(/[\r\n]+/g, '\n') // Chuẩn hóa xuống dòng
      .replace(/\s+/g, ' ');     // Loại bỏ khoảng trắng thừa
  }

  /**
   * Kiểm tra xem các phương án có chứa từ khóa cấm xáo trộn không.
   * (Ví dụ: "Tất cả các đáp án trên", "Cả A và B đều đúng", "None of the above")
   * @param {Array<string>} options - Danh sách lựa chọn
   * @returns {boolean} True nếu KHÔNG được xáo trộn
   */
  static shouldDisableShuffle(options = []) {
    if (!Array.isArray(options) || options.length === 0) return true;

    const exclusionPatterns = [
      /tất cả/i,
      /cả\s+[a-d0-9]/i,
      /cả\s+\d+/i,
      /không có/i,
      /đáp án khác/i,
      /all of the above/i,
      /none of the above/i,
      /both\s+[a-d]\s+and/i
    ];

    return options.some((opt) =>
      exclusionPatterns.some((pattern) => pattern.test(opt))
    );
  }

  /**
   * Tạo đối tượng đề thi hoàn chỉnh (Draft/Master).
   * @param {Object} metadata - Thông tin tổng quan đề thi
   * @param {Array<Object>} rawQuestions - Danh sách câu hỏi thô
   * @returns {Object} Đề thi chuẩn hóa
   */
  static createStandardExam(metadata = {}, rawQuestions = []) {
    const examId = metadata.examId || `exam_${this.generateUUID()}`;
    const timestamp = new Date().toISOString();

    const formattedQuestions = rawQuestions.map((q, idx) => {
      const qId = q.id || `q_${idx + 1}_${this.generateUUID().slice(0, 8)}`;
      const options = (q.options || []).map((opt) => this.sanitizeContent(opt));
      const disableShuffle = q.disableShuffle || this.shouldDisableShuffle(options);

      return {
        id: qId,
        stem: this.sanitizeContent(q.stem || q.questionText || ''),
        images: Array.isArray(q.images) ? q.images : [],
        options: options,
        correctAnswer: q.correctAnswer !== undefined ? q.correctAnswer : null, // Chỉ số 0,1,2,3 hoặc 'A','B','C','D'
        explanation: this.sanitizeContent(q.explanation || ''),
        points: typeof q.points === 'number' ? q.points : 1.0,
        disableShuffle: disableShuffle
      };
    });

    const examData = {
      examId: examId,
      title: metadata.title || 'Đề thi trắc nghiệm',
      subject: metadata.subject || 'Chưa phân loại',
      durationMinutes: metadata.durationMinutes || 45,
      passScore: metadata.passScore || 5.0,
      status: metadata.status || (EXAM_STATUS && EXAM_STATUS.DRAFT) || 'DRAFT',
      createdAt: metadata.createdAt || timestamp,
      updatedAt: timestamp,
      questions: formattedQuestions
    };

    logger.info(`Khởi tạo đề thi thành công: ${examData.title} (${examData.examId})`);
    return examData;
  }

  /**
   * Tách đề thi thành 2 phần độc lập khi xuất bản (Publish):
   * 1. Student Exam: Không chứa đáp án đúng hay lời giải (Lưu trên GitHub/Client)
   * 2. Master Key: Chứa đáp án, lời giải và biểu điểm (Lưu an toàn trên Apps Script Backend)
   * 
   * @param {Object} fullExam - Đề thi gốc
   * @returns {{ studentExam: Object, masterKey: Object }}
   */
  static splitExamForPublishing(fullExam) {
    if (!fullExam || !fullExam.examId) {
      throw new Error('Đề thi không hợp lệ để phân tách.');
    }

    // 1. Dữ liệu đề cho học sinh (Public)
    const studentQuestions = fullExam.questions.map((q) => ({
      id: q.id,
      stem: q.stem,
      images: q.images,
      options: q.options,
      disableShuffle: q.disableShuffle
    }));

    const studentExam = {
      examId: fullExam.examId,
      title: fullExam.title,
      subject: fullExam.subject,
      durationMinutes: fullExam.durationMinutes,
      totalQuestions: studentQuestions.length,
      createdAt: fullExam.createdAt,
      updatedAt: fullExam.updatedAt,
      questions: studentQuestions
    };

    // 2. Đáp án gốc lưu bảo mật (Backend Master Key)
    const keys = fullExam.questions.reduce((acc, q) => {
      acc[q.id] = {
        correctAnswer: q.correctAnswer,
        points: q.points || 1.0,
        explanation: q.explanation || ''
      };
      return acc;
    }, {});

    const masterKey = {
      examId: fullExam.examId,
      updatedAt: new Date().toISOString(),
      keys: keys
    };

    logger.info(`Đã phân tách thành công đề thi ${fullExam.examId} thành Student Exam và Master Key.`);
    return { studentExam, masterKey };
  }

  /**
   * Trộn thứ tự câu hỏi và phương án (Thuật toán Fisher-Yates).
   * @param {Array<Object>} questions - Danh sách câu hỏi
   * @param {boolean} shuffleOptionsFlag - Có xáo trộn cả các phương án A,B,C,D hay không
   * @returns {Array<Object>} Danh sách câu hỏi đã xáo trộn
   */
  static shuffleExamQuestions(questions = [], shuffleOptionsFlag = true) {
    const clonedQuestions = JSON.parse(JSON.stringify(questions));

    // 1. Trộn thứ tự các câu hỏi
    for (let i = clonedQuestions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [clonedQuestions[i], clonedQuestions[j]] = [clonedQuestions[j], clonedQuestions[i]];
    }

    // 2. Trộn phương án nếu cho phép
    if (shuffleOptionsFlag) {
      clonedQuestions.forEach((q) => {
        if (!q.disableShuffle && Array.isArray(q.options) && q.options.length > 1) {
          for (let i = q.options.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [q.options[i], q.options[j]] = [q.options[j], q.options[i]];
          }
        }
      });
    }

    return clonedQuestions;
  }
}

// Export instance thường phục vụ import { examModel } từ app.js
export const examModel = new ExamModel();
