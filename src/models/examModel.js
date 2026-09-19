import { APP_CONFIG, EXAM_STATUS } from '../constants/appConfig.js';
import { logger } from '../utils/logger.js';

export class ExamModel {
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

  sanitizeContent(text) {
    if (!text || typeof text !== 'string') return '';
    return text.trim().replace(/[\r\n]+/g, '\n').replace(/\s+/g, ' ');
  }

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
   * Chuẩn hóa đáp án về chỉ số (Index 0, 1, 2, 3) hoặc giá trị chuỗi
   */
  normalizeCorrectAnswer(correctAnswer, options = []) {
    if (correctAnswer === null || correctAnswer === undefined) return null;

    // Nếu dạng chữ cái 'A', 'B', 'C', 'D' -> chuyển thành index 0, 1, 2, 3
    if (typeof correctAnswer === 'string') {
      const trimmed = correctAnswer.trim().toUpperCase();
      const letterMap = { 'A': 0, 'B': 1, 'C': 2, 'D': 3 };
      if (trimmed in letterMap) return letterMap[trimmed];
      
      // Nếu là chuỗi số "0", "1", "2"
      if (!isNaN(parseInt(trimmed, 10)) && parseInt(trimmed, 10) < options.length) {
        return parseInt(trimmed, 10);
      }

      // Nếu correctAnswer trùng khớp với nội dung văn bản trong options
      const foundIdx = options.findIndex(opt => opt.trim() === correctAnswer.trim());
      if (foundIdx !== -1) return foundIdx;
    }

    if (typeof correctAnswer === 'number') return correctAnswer;
    return null;
  }

  createStandardExam(metadata = {}, rawQuestions = []) {
    const examId = metadata.examId || `exam_${this.generateUUID()}`;
    const timestamp = new Date().toISOString();

    const formattedQuestions = rawQuestions.map((q, idx) => {
      const qId = q.id || `q_${idx + 1}_${this.generateUUID().slice(0, 8)}`;
      const options = (q.options || []).map((opt) => this.sanitizeContent(opt));
      const disableShuffle = q.disableShuffle || this.shouldDisableShuffle(options);
      
      // Chuẩn hóa chỉ số đáp án đúng về kiểu Number (0, 1, 2, 3)
      const normalizedAnswer = this.normalizeCorrectAnswer(q.correctAnswer, options);

      return {
        id: qId,
        stem: this.sanitizeContent(q.stem || q.questionText || ''),
        images: Array.isArray(q.images) ? q.images : [],
        options: options,
        correctAnswer: normalizedAnswer,
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
        correctAnswer: q.correctAnswer, // Chỉ số index chuẩn 0, 1, 2, 3
        correctOptionText: q.options[q.correctAnswer] || null, // Lưu thêm nội dung đáp án để đối chiếu an toàn
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
   * Trộn câu hỏi & phương án (ĐÃ CẬP NHẬT: Tự động cập nhật lại vị trí đáp án đúng)
   */
  shuffleExamQuestions(questions = [], shuffleOptionsFlag = true) {
    const clonedQuestions = JSON.parse(JSON.stringify(questions));

    // 1. Trộn thứ tự các câu hỏi
    for (let i = clonedQuestions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [clonedQuestions[i], clonedQuestions[j]] = [clonedQuestions[j], clonedQuestions[i]];
    }

    // 2. Trộn thứ tự các phương án và cập nhật lại correctAnswer
    if (shuffleOptionsFlag) {
      clonedQuestions.forEach((q) => {
        if (!q.disableShuffle && Array.isArray(q.options) && q.options.length > 1) {
          // Lưu lại nội dung văn bản của đáp án đúng trước khi đảo
          const originalCorrectText = (typeof q.correctAnswer === 'number') ? q.options[q.correctAnswer] : null;

          // Xáo trộn mảng phương án
          for (let i = q.options.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [q.options[i], q.options[j]] = [q.options[j], q.options[i]];
          }

          // Cập nhật lại chỉ số correctAnswer theo vị trí mới sau khi đảo
          if (originalCorrectText !== null) {
            q.correctAnswer = q.options.indexOf(originalCorrectText);
          }
        }
      });
    }

    return clonedQuestions;
  }

  static generateUUID(...args) { return new ExamModel().generateUUID(...args); }
  static sanitizeContent(...args) { return new ExamModel().sanitizeContent(...args); }
  static shouldDisableShuffle(...args) { return new ExamModel().shouldDisableShuffle(...args); }
  static createStandardExam(...args) { return new ExamModel().createStandardExam(...args); }
  static splitExamForPublishing(...args) { return new ExamModel().splitExamForPublishing(...args); }
  static shuffleExamQuestions(...args) { return new ExamModel().shuffleExamQuestions(...args); }
}

export const examModel = new ExamModel();
export const splitExamForPublishing = examModel.splitExamForPublishing.bind(examModel);
export const createStandardExam = examModel.createStandardExam.bind(examModel);

export default examModel;
