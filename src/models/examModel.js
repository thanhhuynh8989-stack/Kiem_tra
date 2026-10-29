import { APP_CONFIG } from '../constants/appConfig.js';

/**
 * EXAM MODEL & FACTORY UTILITIES
 * Chuẩn hóa cấu trúc Đề thi và Câu hỏi trước khi lưu/xuất bản.
 */
export class ExamModel {
  /**
   * Tạo đối tượng Đề thi chuẩn hóa
   */
  static createExam({
    examId = '',
    title = 'Đề thi trắc nghiệm',
    durationMinutes = 45,
    maxViolations = 3,
    createdBy = 'admin',
    questions = []
  }) {
    let cleanId = String(examId || '').trim().toLowerCase().replace(/\.json$/i, '').replace(/^exams\//i, '');
    if (cleanId.includes('-')) cleanId = cleanId.split('-')[0];
    if (!cleanId) cleanId = `exam_${Math.random().toString(36).substring(2, 10)}`;

    return {
      examId: cleanId,
      examCode: `${cleanId}.json`,
      title: String(title).trim() || 'Đề thi trắc nghiệm',
      durationMinutes: Number(durationMinutes) || 45,
      maxViolations: Number(maxViolations) || 3,
      createdBy: String(createdBy).trim() || 'admin',
      createdAt: new Date().toISOString(),
      filePath: `exams/${cleanId}.json`,
      questions: questions.map((q, idx) => ExamModel.normalizeQuestion(q, idx))
    };
  }

  /**
   * Chuẩn hóa cấu trúc 1 câu hỏi trắc nghiệm
   */
  static normalizeQuestion(q = {}, index = 0) {
    const qId = String(q.id || q.qId || `q_${index + 1}`);
    const stem = String(q.stem || q.text || `Câu hỏi ${index + 1}`).trim();

    let rawOptions = Array.isArray(q.options) ? q.options : [];
    let cleanOptions = rawOptions.map(opt => String(opt).replace(/^[A-D][.:)]\s*/i, '').trim());

    // Đảm bảo đủ đúng 4 phương án A, B, C, D
    while (cleanOptions.length < 4) {
      cleanOptions.push('');
    }
    cleanOptions = cleanOptions.slice(0, 4);

    let correctAnswer = 0;
    if (typeof q.correctAnswer === 'number') {
      correctAnswer = q.correctAnswer;
    } else if (typeof q.correctAnswer === 'string') {
      const charCode = q.correctAnswer.trim().toUpperCase().charCodeAt(0);
      if (charCode >= 65 && charCode <= 68) {
        correctAnswer = charCode - 65;
      } else {
        correctAnswer = parseInt(q.correctAnswer) || 0;
      }
    }

    const originalOptionCount = q.originalOptionCount !== undefined ? q.originalOptionCount : rawOptions.filter(o => String(o).trim()).length;
    const isMissingOptions = originalOptionCount < 4 || cleanOptions.some(o => !o);
    const isMissingAnswer = q.correctAnswer === null || q.correctAnswer === undefined;

    return {
      id: qId,
      stem: stem,
      options: cleanOptions,
      correctAnswer: correctAnswer,
      hasImage: Boolean(q.hasImage || q.imageUrl),
      imageUrl: q.imageUrl || null,
      originalOptionCount: originalOptionCount,
      flags: {
        needsUserConfirmation: isMissingOptions || isMissingAnswer,
        isMissingOptions: isMissingOptions,
        isMissingAnswer: isMissingAnswer,
        note: q.flags?.note || (isMissingOptions ? 'Cần bổ sung phương án bị trống' : 'Đã chuẩn hóa')
      }
    };
  }
}

export const examModel = ExamModel;
window.examModel = ExamModel;
