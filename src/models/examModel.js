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
      .replace(/[\r\n]+/g, '\n')
      .replace(/\s+/g, ' ');
  }

  /**
   * Kiểm tra xem các phương án có chứa từ khóa cấm xáo trộn không.
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
   * Phân tách danh sách câu hỏi hoặc đề thi thành 2 phần: Câu hỏi & Bảng đáp án
   * @param {Array|Object} input - Mảng câu hỏi hoặc đối tượng đề thi
   * @returns {Object} { questions, answerKey } hoặc { studentExam, masterKey }
   */
  static splitExamAndKey(input = []) {
    if (Array.isArray(input)) {
      const cleanQuestions = [];
      const answerKey = {};

      input.forEach((q, idx) => {
        const qId = q.id || `q_${idx + 1}`;
        if (q.correctAnswer !== undefined && q.correctAnswer !== null) {
          answerKey[qId] = q.correctAnswer;
        }
        cleanQuestions.push({
          id: qId,
          stem: q.stem || '',
          options: q.options || [],
          explanation: q.explanation || '',
          images: q.images || [],
          disableShuffle: q.disableShuffle || false
        });
      });

      logger.info(`Đã bóc tách ${cleanQuestions.length} câu hỏi và ${Object.keys(answerKey).length} đáp án.`);
      return { questions: cleanQuestions, answerKey };
    }

    if (input && typeof input === 'object' && input.questions) {
      return this.splitExamForPublishing(input);
    }

    return { questions: [], answerKey: {} };
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
        correctAnswer: q.correctAnswer !== undefined ? q.correctAnswer : null,
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
   * Tách đề thi thành 2 phần độc lập khi xuất bản (Publish)
   * @param {Object} fullExam - Đề thi gốc
   * @returns {{ studentExam: Object, masterKey: Object }}
   */
  static splitExamForPublishing(fullExam) {
    if (!fullExam || !fullExam.examId) {
      throw new Error('Đề thi không hợp lệ để phân tách.');
    }

    const studentQuestions = (fullExam.questions || []).map((q) => ({
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

    const keys = (fullExam.questions || []).reduce((acc, q) => {
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
    return { studentExam, masterKey, questions: studentQuestions, answerKey: keys };
  }

  /**
   * Trộn thứ tự câu hỏi và phương án (Thuật toán Fisher-Yates).
   * @param {Array<Object>} questions - Danh sách câu hỏi
   * @param {boolean} shuffleOptionsFlag - Có xáo trộn cả các phương án A,B,C,D hay không
   * @returns {Array<Object>} Danh sách câu hỏi đã xáo trộn
   */
  static shuffleExamQuestions(questions = [], shuffleOptionsFlag = true) {
    const clonedQuestions = JSON.parse(JSON.stringify(questions));

    for (let i = clonedQuestions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [clonedQuestions[i], clonedQuestions[j]] = [clonedQuestions[j], clonedQuestions[i]];
    }

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

// Export object chứa đầy đủ phương thức tĩnh để đáp ứng gọi dạng examModel.splitExamAndKey()
export const examModel = {
  generateUUID: ExamModel.generateUUID.bind(ExamModel),
  sanitizeContent: ExamModel.sanitizeContent.bind(ExamModel),
  shouldDisableShuffle: ExamModel.shouldDisableShuffle.bind(ExamModel),
  splitExamAndKey: ExamModel.splitExamAndKey.bind(ExamModel),
  createStandardExam: ExamModel.createStandardExam.bind(ExamModel),
  splitExamForPublishing: ExamModel.splitExamForPublishing.bind(ExamModel),
  shuffleExamQuestions: ExamModel.shuffleExamQuestions.bind(ExamModel)
};

// Export các hàm lẻ để tương thích với gọi dạng import { splitExamAndKey }
export const splitExamAndKey = ExamModel.splitExamAndKey.bind(ExamModel);
export const splitExamForPublishing = ExamModel.splitExamForPublishing.bind(ExamModel);
export const createStandardExam = ExamModel.createStandardExam.bind(ExamModel);
