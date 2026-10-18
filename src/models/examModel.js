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

    if (typeof correctAnswer === 'string') {
      const trimmed = correctAnswer.trim().toUpperCase();
      const letterMap = { 'A': 0, 'B': 1, 'C': 2, 'D': 3 };
      if (trimmed in letterMap) return letterMap[trimmed];
      
      if (!isNaN(parseInt(trimmed, 10)) && parseInt(trimmed, 10) < options.length) {
        return parseInt(trimmed, 10);
      }

      const foundIdx = options.findIndex(opt => opt && opt.trim() === correctAnswer.trim());
      if (foundIdx !== -1) return foundIdx;
    }

    if (typeof correctAnswer === 'number' && correctAnswer >= 0 && correctAnswer < options.length) {
      return correctAnswer;
    }
    return null;
  }

  /**
   * Tạo cấu trúc đề thi chuẩn hóa (Khắc phục triệt để lỗi báo sai cờ isMissingAnswer)
   */
  createStandardExam(metadata = {}, rawQuestions = []) {
    const examId = metadata.examId || metadata.id || `exam_${this.generateUUID()}`;
    const timestamp = new Date().toISOString();

    const formattedQuestions = rawQuestions.map((q, idx) => {
      const qId = q.id || `q_${idx + 1}_${this.generateUUID().slice(0, 8)}`;
      const rawOpts = Array.isArray(q.options) ? q.options : ['', '', '', ''];
      const options = rawOpts.map((opt) => this.sanitizeContent(opt));
      while (options.length < 4) options.push('');

      const disableShuffle = q.disableShuffle || this.shouldDisableShuffle(options);
      
      // 1. Kiểm tra chính xác xem đã tìm thấy đáp án hợp lệ chưa
      const normalizedAnswer = this.normalizeCorrectAnswer(q.correctAnswer, options);
      const hasValidAnswer = (normalizedAnswer !== null && normalizedAnswer >= 0 && normalizedAnswer < 4);
      
      // 2. Kiểm tra phương án trống hoặc thiếu
      const origCount = q.originalOptionCount !== undefined ? q.originalOptionCount : 4;
      const hasEmptyOption = options.some(o => !o.trim());
      const isMissingOpts = origCount < 4 || hasEmptyOption;
      const isMissingAns = !hasValidAnswer;

      // 3. Cập nhật Note cảnh báo đồng nhất với trạng thái đáp án thực tế
      let noteText = '';
      if (isMissingOpts) {
        noteText = `Đề gốc có ${origCount}/4 phương án. Vui lòng bổ sung phương án bị trống.`;
      } else if (isMissingAns) {
        noteText = 'Chưa tìm thấy đáp án gốc trong đề (Tạm chọn A). Vui lòng kiểm tra lại.';
      } else {
        const letter = String.fromCharCode(65 + normalizedAnswer);
        noteText = `Đã nhận diện đáp án gốc (${letter}).`;
      }

      const needsConfirmation = isMissingOpts || isMissingAns;

      return {
        id: qId,
        stem: this.sanitizeContent(q.stem || q.questionText || ''),
        images: Array.isArray(q.images) ? q.images : [],
        hasImage: Boolean(q.hasImage || (Array.isArray(q.images) && q.images.length > 0)),
        imageUrl: q.imageUrl || null,
        imageBox: q.imageBox || null,
        options: options.slice(0, 4),
        correctAnswer: hasValidAnswer ? normalizedAnswer : 0,
        explanation: this.sanitizeContent(q.explanation || ''),
        points: typeof q.points === 'number' ? q.points : 1.0,
        disableShuffle: disableShuffle,
        originalOptionCount: origCount,
        flags: {
          needsUserConfirmation: needsConfirmation,
          isMissingOptions: isMissingOpts,
          isMissingAnswer: isMissingAns,
          note: noteText
        }
      };
    });

    const examData = {
      id: examId,
      examId: examId,
      title: metadata.title || 'Đề thi trắc nghiệm',
      subject: metadata.subject || 'Chưa phân loại',
      durationMinutes: metadata.durationMinutes || 45,
      passScore: metadata.passScore || 5.0,
      maxViolations: metadata.maxViolations || 3,
      status: metadata.status || (EXAM_STATUS && EXAM_STATUS.DRAFT) || 'DRAFT',
      createdBy: metadata.createdBy || 'system',
      createdByName: metadata.createdByName || 'Hệ thống',
      createdAt: metadata.createdAt || timestamp,
      updatedAt: timestamp,
      questions: formattedQuestions
    };

    if (typeof logger !== 'undefined' && logger.info) {
      logger.info(`Khởi tạo đề thi thành công: ${examData.title} (${examData.examId})`);
    }
    return examData;
  }

  splitExamForPublishing(fullExam) {
    if (!fullExam || (!fullExam.examId && !fullExam.id)) {
      throw new Error('Đề thi không hợp lệ để phân tách.');
    }

    const examId = fullExam.examId || fullExam.id;

    const studentQuestions = (fullExam.questions || []).map((q) => ({
      id: q.id,
      stem: q.stem,
      images: q.images || [],
      hasImage: Boolean(q.hasImage),
      imageUrl: q.imageUrl || null,
      options: q.options,
      disableShuffle: q.disableShuffle
    }));

    const studentExam = {
      id: examId,
      examId: examId,
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
        correctOptionText: q.options[q.correctAnswer] || null,
        points: q.points || 1.0,
        explanation: q.explanation || ''
      };
      return acc;
    }, {});

    const masterKey = {
      id: examId,
      examId: examId,
      updatedAt: new Date().toISOString(),
      keys: keys
    };

    if (typeof logger !== 'undefined' && logger.info) {
      logger.info(`Đã phân tách thành công đề thi ${examId}.`);
    }
    return { studentExam, masterKey, questions: studentQuestions, answerKey: keys };
  }

  shuffleExamQuestions(questions = [], shuffleOptionsFlag = true) {
    const clonedQuestions = JSON.parse(JSON.stringify(questions));

    for (let i = clonedQuestions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [clonedQuestions[i], clonedQuestions[j]] = [clonedQuestions[j], clonedQuestions[i]];
    }

    if (shuffleOptionsFlag) {
      clonedQuestions.forEach((q) => {
        if (!q.disableShuffle && Array.isArray(q.options) && q.options.length > 1) {
          const originalCorrectText = (typeof q.correctAnswer === 'number') ? q.options[q.correctAnswer] : null;

          for (let i = q.options.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [q.options[i], q.options[j]] = [q.options[j], q.options[i]];
          }

          if (originalCorrectText !== null) {
            q.correctAnswer = q.options.indexOf(originalCorrectText);
          }
        }
      });
    }

    return clonedQuestions;
  }
}

// Khởi tạo Instance Singleton duy nhất
export const examModel = new ExamModel();

// Export rời các phương thức để hỗ trợ Import trực tiếp
export const createStandardExam = (meta, questions) => examModel.createStandardExam(meta, questions);
export const splitExamForPublishing = (fullExam) => examModel.splitExamForPublishing(fullExam);
export const shuffleExamQuestions = (questions, flag) => examModel.shuffleExamQuestions(questions, flag);

export default examModel;
