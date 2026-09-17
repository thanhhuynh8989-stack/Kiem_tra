import { APP_CONFIG, EXAM_STATUS } from '../constants/appConfig.js';
import { logger } from '../utils/logger.js';

/**
 * Model quản lý cấu trúc dữ liệu đề thi, tách đáp án và xử lý trộn câu hỏi.
 */
export class ExamModel {
  /**
   * Tạo chuỗi UUID v4 duy nhất cho đề thi hoặc câu hỏi.
   */
  generateUUID() {
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
   */
  sanitizeContent(text) {
    if (!text || typeof text !== 'string') return '';
    return text.trim().replace(/[\r\n]+/g, '\n').replace(/\s+/g, ' ');
  }

  /**
   * Kiểm tra xem các phương án có chứa từ khóa cấm xáo trộn không.
   */
  shouldDisableShuffle(options = []) {
    if (!Array.isArray(options) || options.length === 0) return true;

    const exclusionPatterns = [
      /tất cả/i, /cả\s+[a-d0-9]/i, /cả\s+\d+/i, /không có/i,
      /đáp án khác/i, /all of the above/i, /none of the above/i, /both\s+[a-d]\s+and/i
    ];

    return options.some((opt) =>
      exclusionPatterns.some((pattern) => pattern.test(opt))
    );
  }

  /**
   * Phân tách danh sách câu hỏi hoặc đề thi thành 2 phần: Câu hỏi & Bảng đáp án
   */
  splitExamAndKey(input = []) {
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
   */
  createStandardExam(metadata = {}, rawQuestions = []) {
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
   */
  splitExamForPublishing(fullExam) {
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

    logger.info(`Đã phân tách thành công đề thi ${fullExam.examId}.`);
    return { studentExam, masterKey, questions: studentQuestions, answerKey: keys };
  }

  /**
   * Trộn thứ tự câu hỏi và phương án (Thuật toán Fisher-Yates).
   */
  shuffleExamQuestions(questions = [], shuffleOptionsFlag = true) {
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

  // --- Hỗ trợ gọi Static trực tiếp từ Lớp ExamModel.method() ---
  static generateUUID(...args) { return new ExamModel().generateUUID(...args); }
  static sanitizeContent(...args) { return new ExamModel().sanitizeContent(...args); }
  static shouldDisableShuffle(...args) { return new ExamModel().shouldDisableShuffle(...args); }
  static splitExamAndKey(...args) { return new ExamModel().splitExamAndKey(...args); }
  static createStandardExam(...args) { return new ExamModel().createStandardExam(...args); }
  static splitExamForPublishing(...args) { return new ExamModel().splitExamForPublishing(...args); }
  static shuffleExamQuestions(...args) { return new ExamModel().shuffleExamQuestions(...args); }
}

// 1. Export Instance Singleton
export const examModel = new ExamModel();

// 2. Export Hàm lẻ (Destructuring)
export const splitExamAndKey = examModel.splitExamAndKey.bind(examModel);
export const splitExamForPublishing = examModel.splitExamForPublishing.bind(examModel);
export const createStandardExam = examModel.createStandardExam.bind(examModel);

// 3. Export Default (Cho phép: import examModel from './examModel.js')
export default examModel;
