// =========================================================================
// FILE: src/modules/studentExamTaking.js
// =========================================================================

import { appsScriptService } from '../services/appsScriptService.js';
import { renderKaTeX } from '../utils/domHelper.js';
import {
  getLoggedInUsername,
  getLoggedInUser,
  showAppLoading,
  hideAppLoading,
  escapeHtml
} from './authAndCore.js';
import { AntiCheatEngine } from './antiCheatEngine.js';

let activeAntiCheatInstance = null;

export function resetExamSessionState() {
  window.currentActiveAnswersForExam = {};
  if (typeof window.userAnswers !== 'undefined') {
    window.userAnswers = {};
  }
}

function shuffleArray(arr) {
  const array = [...arr];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export const ExamDraftManager = {
  getDraftKey(username, examId) {
    const cleanId = String(examId || '')
      .trim()
      .toLowerCase()
      .replace(/\.json$/i, '')
      .replace(/^exams\//i, '');
    const matchHex = cleanId.match(/(exam_[a-f0-9]{8})/i);
    const shortId = matchHex ? matchHex[1].toLowerCase() : cleanId;
    return `exam_draft_${String(username).trim().toLowerCase()}_${shortId}`;
  },

  saveDraft(username, examId, userAnswers, remainingSeconds, layout = null, violationCount = 0) {
    if (!username || !examId) return;
    const key = this.getDraftKey(username, examId);
    const existing = this.getDraft(username, examId) || {};
    localStorage.setItem(
      key,
      JSON.stringify({
        answers: userAnswers,
        remainingSeconds: remainingSeconds,
        layout: layout || existing.layout || null,
        violationCount: Number(violationCount) || 0,
        updatedAt: Date.now()
      })
    );
  },

  getDraft(username, examId) {
    if (!username || !examId) return null;
    const key = this.getDraftKey(username, examId);
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : null;
  },

  clearDraft(username, examId) {
    if (!username || !examId) return;
    const key = this.getDraftKey(username, examId);
    localStorage.removeItem(key);
  }
};

function normalizeChoice(val) {
  if (val === undefined || val === null) return { letter: '', index: '' };
  const str = String(val).trim().toUpperCase();
  const letterToIdx = { A: '0', B: '1', C: '2', D: '3' };
  const idxToLetter = { '0': 'A', '1': 'B', '2': 'C', '3': 'D' };
  if (letterToIdx[str] !== undefined) return { letter: str, index: letterToIdx[str] };
  if (idxToLetter[str] !== undefined) return { letter: idxToLetter[str], index: str };
  return { letter: str, index: str };
}

export async function handleLoadStudentDashboard() {
  const container = document.getElementById('studentExamContainer');
  if (!container) return;

  const studentCode = getLoggedInUsername();
  if (!studentCode || studentCode === '--') {
    container.innerHTML = '<p style="color:#ef4444; padding: 12px;">⚠️ Chưa xác thực được tài khoản sinh viên.</p>';
    return;
  }

  container.innerHTML = '<p style="color:#2563eb; font-size: 13px; padding: 12px;">🔄 Đang nạp danh sách bài thi...</p>';
  try {
    const res = await appsScriptService.request('GET_STUDENT_EXAMS', {
      username: studentCode,
      studentCode: studentCode
    });
    renderStudentDashboard(res.exams || res.data || []);
  } catch (err) {
    container.innerHTML = `<p style="color:#ef4444; font-size: 13px; padding:12px;">⚠️ Lỗi nạp bài thi: ${escapeHtml(err.message)}</p>`;
  }
}

export function renderStudentDashboard(exams = []) {
  const container = document.getElementById('studentExamContainer');
  if (!container) return;

  const username = getLoggedInUsername();
  let html = `
    <div style="background:#fff; border:1px solid var(--border); border-radius:10px; padding:16px;">
      <h3 style="margin:0 0 12px 0; font-size: 16px; color:#0f172a;">📝 Danh Sách Bài Thi Được Gán (${exams.length})</h3>
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap:12px;">
  `;

  if (exams.length === 0) {
    html += '<div style="grid-column: 1/-1; text-align:center; padding:20px; color:var(--text-muted);">Hiện chưa có bài thi nào được giao.</div>';
  } else {
    exams.forEach(ex => {
      const hasScore = ex.score !== null && ex.score !== undefined && ex.score !== '';
      const isCompleted = ex.isCompleted || hasScore;

      if (ex.wasReset) {
        ExamDraftManager.clearDraft(username, ex.examId);
        ExamDraftManager.clearDraft(username, ex.examCode);
      }

      const draft = ExamDraftManager.getDraft(username, ex.examId) || ExamDraftManager.getDraft(username, ex.examCode);
      const hasDraft = !isCompleted && draft && Object.keys(draft.answers || {}).length > 0;

      html += `
        <div style="border:1px solid ${isCompleted ? '#bbf7d0' : (hasDraft ? '#fde68a' : '#cbd5e1')}; border-radius:8px; padding: 12px; display: flex; flex-direction:column; justify-content:space-between; gap:8px;">
          <div>
            <strong style="font-size:14px; color:#0f172a;">${escapeHtml(ex.title)}</strong>
            <div style="font-size:12px; color:var(--text-muted);">Mã đề: ${escapeHtml(ex.examCode || ex.examId)} | ${ex.durationMinutes} phút</div>
          </div>
          <div style="display: flex; justify-content:space-between; align-items:center; border-top:1px solid #f1f5f9; padding-top:8px;">
            <span style="font-weight:700; color:${hasScore ? '#15803d' : '#94a3b8'}; font-size:14px;">${hasScore ? `${ex.score}/10` : '--'}</span>
            ${isCompleted
              ? `<button type="button" onclick="window.handleReviewSubmittedExam('${escapeHtml(ex.examId)}', '${escapeHtml(ex.examCode || '')}')" style="background:#0d9488; color:#fff; border:none; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px;">👁️ Xem lại bài</button>`
              : `<button type="button" onclick="window.handleStartTakeExam('${escapeHtml(ex.examId)}', '${escapeHtml(ex.examCode || '')}')" style="background:${hasDraft ? '#d97706' : '#2563eb'}; color:#fff; border:none; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px;">${hasDraft ? '✏️ Làm tiếp' : '🚀 Làm bài'}</button>`
            }
          </div>
        </div>
      `;
    });
  }

  html += '</div></div>';
  container.innerHTML = html;
}

export async function handleStartTakeExam(examId, examCode = '') {
  if (activeAntiCheatInstance) {
    activeAntiCheatInstance.stop();
    activeAntiCheatInstance = null;
  }

  const username = getLoggedInUsername();
  resetExamSessionState();
  showAppLoading('⏳ Đang tải đề thi & khởi tạo xáo trộn...');

  try {
    let rawName = String(examCode || examId).trim();
    if (rawName.includes('-')) rawName = rawName.split('-')[0];
    if (!rawName.endsWith('.json')) rawName = `${rawName}.json`;

    const filePath = `exams/${rawName}`;
    const cdnUrl = `https://raw.githubusercontent.com/thanhhuynh8989-stack/Kiem_tra/main/${filePath}?v=${Date.now()}`;
    const res = await fetch(cdnUrl);
    if (!res.ok) throw new Error('Không thể tải file bài thi từ CDN.');

    const examData = await res.json();
    const rawQuestions = examData.questions || examData;
    hideAppLoading();

    const draft = ExamDraftManager.getDraft(username, examId) || ExamDraftManager.getDraft(username, rawName);
    let initialAnswers = {};
    let initialTimeSeconds = (examData.durationMinutes || 45) * 60;
    let shuffledLayout = null;
    let initialViolationCount = 0;

    if (draft) {
      window.isInternalDialogActive = true;
      const wantContinue = confirm('📌 Bạn có muốn tiếp tục làm bài thi dở không?');
      setTimeout(() => { window.isInternalDialogActive = false; }, 500);

      if (wantContinue) {
        initialAnswers = draft.answers || {};
        if (draft.remainingSeconds > 0) initialTimeSeconds = draft.remainingSeconds;
        shuffledLayout = draft.layout || null;
        initialViolationCount = Number(draft.violationCount) || 0;
      }
    }

    if (!shuffledLayout) {
      shuffledLayout = rawQuestions.map((q, idx) => {
        const qId = String(q.id || (idx + 1));
        const originalOptions = (q.options || []).map((optText, oIdx) => ({
          originalLetter: String.fromCharCode(65 + oIdx),
          originalIndex: oIdx,
          text: String(optText).replace(/^[A-D][.:)]\s*/i, '')
        }));
        return {
          qId: qId,
          stem: q.stem || q.text || '',
          shuffledOptions: shuffleArray(originalOptions)
        };
      });
      shuffledLayout = shuffleArray(shuffledLayout);
    }

    renderTakeExamScreen(examId, rawName, shuffledLayout, initialAnswers, initialTimeSeconds, initialViolationCount);
  } catch (err) {
    hideAppLoading();
    alert(`❌ Lỗi: ${err.message}`);
  }
}

export function renderTakeExamScreen(examId, fileName, shuffledQuestions, savedAnswers = {}, totalSeconds = 2700, initialViolationCount = 0) {
  const container = document.getElementById('studentExamContainer');
  if (!container) return;

  const username = getLoggedInUsername();
  let currentAnswers = { ...savedAnswers };
  let remainingSeconds = totalSeconds;

  ExamDraftManager.saveDraft(username, examId, currentAnswers, remainingSeconds, shuffledQuestions, initialViolationCount);

  let html = `
    <div class="exam-prevent-select" style="background:#fff; border-radius: 10px; padding: 16px; border:1px solid var(--border);">
      <div style="position:sticky; top: 10px; z-index: 100; background:#0f172a; color:#fff; padding: 10px 16px; border-radius:8px; display: flex; justify-content:space-between; align-items:center; margin-bottom: 16px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
        <span style="font-weight:600; font-size:14px;">📄 ${escapeHtml(fileName)} <small style="color:#38bdf8; margin-left:8px;">(Đã xáo trộn)</small></span>
        <div id="examTimerDisplay" style="font-size:16px; font-weight:700; color:#38bdf8;">00:00</div>
      </div>
      <div>
        ${shuffledQuestions.map((q, visualIdx) => {
          const qId = String(q.qId);
          const selectedOriginalAns = currentAnswers[qId] || '';
          return `
            <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:14px; margin-bottom:14px;">
              <strong style="color:#0f172a; font-size:14px;">Câu ${visualIdx + 1}:</strong> ${escapeHtml(q.stem)}
              <div style="margin-top:10px; display:flex; flex-direction:column; gap:8px;">
                ${q.shuffledOptions.map((optObj, visualOptIdx) => {
                  const visualLetter = String.fromCharCode(65 + visualOptIdx);
                  const isChecked = selectedOriginalAns === optObj.originalLetter;
                  return `
                    <label class="exam-option-card" style="border-color:${isChecked ? '#2563eb' : '#cbd5e1'}; background:${isChecked ? '#eff6ff' : '#fff'};">
                      <input type="radio" name="take_ans_${qId}" value="${optObj.originalLetter}" ${isChecked ? 'checked' : ''}
                        onchange="window.handleStudentSelectOption('${escapeHtml(examId)}', '${escapeHtml(qId)}', '${optObj.originalLetter}')" style="margin-right:8px;">
                      <strong style="color:${isChecked ? '#2563eb' : '#475569'};">${visualLetter}.</strong> ${escapeHtml(optObj.text)}
                    </label>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
      <button type="button" onclick="window.handleConfirmSubmitExam('${escapeHtml(examId)}', ${shuffledQuestions.length})" style="background:#16a34a; color:#fff; font-size: 15px; font-weight:600; padding: 12px; border:none; border-radius:8px; width: 100%; margin-top:16px; cursor:pointer;">
        📤 Nộp Bài Thi
      </button>
    </div>
  `;

  container.innerHTML = html;
  if (typeof renderKaTeX === 'function') {
    setTimeout(() => renderKaTeX(container), 50);
  }

  // Khởi tạo Module Chống Gian Lận Độc Lập
  activeAntiCheatInstance = new AntiCheatEngine({
    maxViolations: 3,
    gracePeriodMs: 3000,
    enableFullscreenPC: true,
    onViolation: (count, reason) => {
      ExamDraftManager.saveDraft(username, examId, currentAnswers, remainingSeconds, shuffledQuestions, count);
    },
    onMaxViolationsReached: (count, reason) => {
      executeSubmitExam(examId, shuffledQuestions, currentAnswers, `Tự động nộp bài do vi phạm 3 lần: ${reason}`, true);
    }
  });
  activeAntiCheatInstance.start(initialViolationCount);

  const timerEl = document.getElementById('examTimerDisplay');
  if (window.activeExamTimer) clearInterval(window.activeExamTimer);

  const timerInterval = setInterval(() => {
    remainingSeconds--;

    if (remainingSeconds % 5 === 0) {
      ExamDraftManager.saveDraft(
        username,
        examId,
        currentAnswers,
        remainingSeconds,
        shuffledQuestions,
        activeAntiCheatInstance ? activeAntiCheatInstance.violationCount : 0
      );
    }

    if (remainingSeconds <= 0) {
      clearInterval(timerInterval);
      alert('⏰ Đã hết giờ làm bài! Hệ thống đang tự động nộp bài.');
      executeSubmitExam(examId, shuffledQuestions, currentAnswers);
      return;
    }

    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    if (timerEl) {
      timerEl.innerText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
  }, 1000);

  window.activeExamTimer = timerInterval;
  window.currentActiveQuestionsForExam = shuffledQuestions;
  window.currentActiveAnswersForExam = currentAnswers;
  window.currentActiveExamId = examId;

  window.handleStudentSelectOption = function (eId, questionId, originalLetter) {
    currentAnswers[String(questionId)] = originalLetter;
    ExamDraftManager.saveDraft(
      username,
      eId,
      currentAnswers,
      remainingSeconds,
      shuffledQuestions,
      activeAntiCheatInstance ? activeAntiCheatInstance.violationCount : 0
    );
  };
}

export async function handleConfirmSubmitExam(examId, totalQuestions) {
  const username = getLoggedInUsername();
  const draft = ExamDraftManager.getDraft(username, examId);
  const answers = draft ? draft.answers : (window.currentActiveAnswersForExam || {});
  const answeredCount = Object.keys(answers).filter(k => answers[k]).length;

  let confirmMsg = `Bạn đã hoàn thành ${answeredCount}/${totalQuestions} câu.\nBạn có chắc chắn muốn NỘP BÀI THI ngay bây giờ không?`;
  if (answeredCount < totalQuestions) {
    confirmMsg = `⚠️ CẢNH BÁO: Bạn vẫn còn ${totalQuestions - answeredCount} câu chưa trả lời!\n\n` + confirmMsg;
  }

  window.isInternalDialogActive = true;
  const isConfirmed = confirm(confirmMsg);
  setTimeout(() => { window.isInternalDialogActive = false; }, 500);

  if (isConfirmed) {
    if (window.activeExamTimer) clearInterval(window.activeExamTimer);
    const questions = window.currentActiveQuestionsForExam || [];
    executeSubmitExam(examId, questions, answers);
  }
}

export async function executeSubmitExam(
  examId = (window.currentActiveExamId || window.currentExamId),
  questions = (window.currentActiveQuestionsForExam || window.currentExamQuestions || []),
  answers = (window.currentActiveAnswersForExam || window.currentStudentAnswers || {}),
  customReason = null,
  customAutoSubmitted = null
) {
  showAppLoading('⏳ Đang tính điểm & gửi bài...');

  if (activeAntiCheatInstance) {
    activeAntiCheatInstance.stop();
    activeAntiCheatInstance = null;
  }

  try {
    const username = getLoggedInUsername();
    let rawExamId = String(examId || window.currentActiveExamId || '').trim();
    let shortExamId = rawExamId.toLowerCase().replace(/\.json$/i, '').replace(/^exams\//i, '');
    const matchHex = shortExamId.match(/(exam_[a-f0-9]{8})/i);
    if (matchHex) shortExamId = matchHex[1].toLowerCase();

    const activeQuestions = (Array.isArray(questions) && questions.length > 0)
      ? questions
      : (window.currentActiveQuestionsForExam || []);

    const rawAnswers = (answers && typeof answers === 'object' && Object.keys(answers).length > 0)
      ? answers
      : (window.currentActiveAnswersForExam || {});

    const cleanAnswersMap = {};
    Object.keys(rawAnswers).forEach(key => {
      const val = rawAnswers[key];
      if (val !== undefined && val !== null) {
        const strVal = String(val).trim();
        if (strVal !== '' && strVal !== 'null' && strVal !== 'undefined') {
          cleanAnswersMap[String(key)] = strVal;
        }
      }
    });

    let loggedUser = getLoggedInUser() || {};
    const violationCount = Number(window.violationCount) || 0;
    const isAutoSubmitted = customAutoSubmitted !== null
      ? Boolean(customAutoSubmitted)
      : violationCount >= 3;

    const reason = customReason || (
      isAutoSubmitted
        ? 'Tự động nộp do vi phạm quy chế (quá 3 lần)'
        : 'Nộp bài thi'
    );

    const payload = {
      examId: shortExamId,
      username: username,
      studentCode: username,
      studentName: loggedUser.fullName || loggedUser.name || username,
      studentClass: loggedUser.className || loggedUser.class || '',
      answers: cleanAnswersMap,
      totalQuestions: activeQuestions.length,
      violationInfo: {
        violationCount: violationCount,
        isAutoSubmitted: isAutoSubmitted,
        reason: reason
      }
    };

    const res = await appsScriptService.request('SUBMIT_EXAM', payload);

    if (res && res.status === 'error') {
      throw new Error(res.message || 'Lỗi xác thực từ Server khi chấm bài!');
    }

    resetExamSessionState();
    ExamDraftManager.clearDraft(username, rawExamId);
    ExamDraftManager.clearDraft(username, shortExamId);
    ExamDraftManager.clearDraft(username, `${shortExamId}.json`);

    hideAppLoading();

    const finalGrade = res.finalGrade !== undefined ? res.finalGrade : (res.score !== undefined ? res.score : 0);
    const correctCount = res.correctCount !== undefined ? res.correctCount : 0;
    const answeredCount = res.answeredCount !== undefined ? res.answeredCount : Object.keys(cleanAnswersMap).length;
    const totalQ = res.totalQuestions || activeQuestions.length;

    alert(
      `🎉 Đã nộp bài thành công!\n` +
      `Điểm số: ${finalGrade} / 10\n` +
      `Số câu đúng: ${correctCount}/${totalQ}\n` +
      `Số câu đã làm: ${answeredCount}/${totalQ}`
    );

    if (typeof handleLoadStudentDashboard === 'function') {
      handleLoadStudentDashboard();
    } else if (typeof window.switchTab === 'function') {
      window.switchTab('tab-student-exams');
    }
  } catch (err) {
    hideAppLoading();
    alert(`❌ Lỗi nộp bài: ${err.message}`);
  }
}

export async function handleReviewSubmittedExam(arg1, arg2 = '', arg3 = '') {
  const currentUsername = getLoggedInUsername();
  let examId = String(arg1 || '').trim();
  let targetStudentCode = '';
  let examCode = '';

  const arg2Str = String(arg2 || '').trim();
  if (arg2Str.toLowerCase().endsWith('.json') || arg2Str.toLowerCase().startsWith('exam_')) {
    examCode = arg2Str;
    targetStudentCode = currentUsername;
  } else if (arg2Str !== '') {
    targetStudentCode = arg2Str;
    examCode = String(arg3 || '').trim();
  } else {
    targetStudentCode = currentUsername;
    examCode = String(arg3 || '').trim();
  }

  const studentCodeToFetch = String(targetStudentCode || currentUsername).trim();
  if (!examId || !studentCodeToFetch) {
    alert('⚠️ Thiếu thông tin Mã đề thi hoặc Mã sinh viên để xem bài làm!');
    return;
  }

  showAppLoading('⏳ Đang tải bài làm đã nộp...');
  try {
    let cleanExamId = String(examId).trim().toLowerCase().replace(/\.json$/i, '').replace(/^exams\//i, '');
    let rawName = String(examCode || cleanExamId).trim();
    if (rawName.includes('-')) rawName = rawName.split('-')[0];
    if (!rawName.endsWith('.json')) rawName = `${rawName}.json`;

    let questions = [];
    let examTitle = rawName;

    try {
      const fileUrl = `https://raw.githubusercontent.com/thanhhuynh8989-stack/Kiem_tra/main/exams/${cleanExamId}.json?v=${Date.now()}`;
      const fetchRes = await fetch(fileUrl);
      if (fetchRes.ok) {
        const textData = await fetchRes.text();
        if (textData.trim().startsWith('{') || textData.trim().startsWith('[')) {
          const examJson = JSON.parse(textData);
          questions = examJson.questions || examJson || [];
          examTitle = examJson.title || rawName;
        }
      } else {
        const serverExam = await appsScriptService.request('GET_EXAM_DETAIL', { examId: cleanExamId });
        if (serverExam && serverExam.status === 'success' && serverExam.examData) {
          questions = serverExam.examData.questions || serverExam.examData || [];
          examTitle = serverExam.examData.title || rawName;
        }
      }
    } catch (e) {
      console.warn('⚠️ Lỗi nạp đề thi CDN, chuyển sang chế độ dự phòng:', e);
    }

    const subRes = await appsScriptService.request('GET_SUBMISSION_DETAIL', {
      examId: cleanExamId,
      studentCode: studentCodeToFetch,
      username: studentCodeToFetch
    });

    hideAppLoading();

    if (!subRes || subRes.status === 'error') {
      alert(`❌ Lỗi: ${subRes?.message || 'Không tìm thấy dữ liệu bài nộp của sinh viên này!'}`);
      return;
    }

    let studentAnswers = {};
    if (typeof subRes.answers === 'object' && subRes.answers !== null) {
      studentAnswers = subRes.answers;
    } else if (typeof subRes.answers === 'string') {
      try { studentAnswers = JSON.parse(subRes.answers); } catch (e) { studentAnswers = {}; }
    }

    renderExamReviewUI({
      examId: cleanExamId,
      fileName: examTitle,
      questions: questions,
      studentAnswers: studentAnswers,
      score: subRes.score !== undefined ? subRes.score : 0,
      submittedAt: subRes.submittedAt || '--',
      studentCode: subRes.studentCode || studentCodeToFetch,
      studentName: subRes.studentName || subRes.fullName || studentCodeToFetch,
      studentClass: subRes.studentClass || subRes.className || '',
      isLecturerView: (currentUsername.toLowerCase() !== studentCodeToFetch.toLowerCase())
    });
  } catch (err) {
    hideAppLoading();
    alert(`❌ Lỗi: ${err.message}`);
  }
}

export function renderExamReviewUI(data) {
  const config = (typeof data === 'object' && data !== null && !Array.isArray(data)) ? data : {
    fileName: arguments[0],
    questions: arguments[1] || [],
    studentAnswers: arguments[2] || {},
    score: arguments[3] || 0,
    submittedAt: arguments[4] || '--',
    isLecturerView: false
  };

  const {
    examId = '',
    fileName = '',
    questions = [],
    studentAnswers = {},
    score = 0,
    submittedAt = '--',
    studentCode = '',
    studentName = '',
    studentClass = '',
    isLecturerView = false
  } = config;

  let container = null;
  const submissionsEl = document.getElementById('submissionsContainer');
  const studentExamEl = document.getElementById('studentExamContainer');
  const lecturerDashEl = document.getElementById('lecturerDashboardContainer');

  if (isLecturerView) {
    container = submissionsEl || lecturerDashEl;
    if (lecturerDashEl && container !== lecturerDashEl) {
      lecturerDashEl.style.display = 'none';
    }
  } else {
    container = studentExamEl;
    if (submissionsEl) submissionsEl.style.display = 'none';
  }

  if (!container) container = document.getElementById('mainContentArea');
  if (!container) return;

  container.style.display = 'block';

  const backAction = isLecturerView
    ? `window.handleViewExamSubmissions('${escapeHtml(examId)}')`
    : 'window.handleLoadStudentDashboard()';

  let html = `
    <div style="background:#fff; border-radius: 10px; padding: 16px; border:1px solid var(--border, #cbd5e1); margin-top:10px;">
      <div style="display: flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap: 12px; margin-bottom:16px; background:#f8fafc; padding: 14px; border-radius:8px; border:1px solid #e2e8f0;">
        <div>
          <h4 style="margin:0 0 4px 0; color:#0f172a; font-size:16px;">📖 Bài làm: ${escapeHtml(fileName)}</h4>
          ${studentCode ? `
            <div style="font-size:13px; color:#334155; margin-top:2px;">
              👨‍🎓 Sinh viên: <strong>${escapeHtml(studentName)}</strong> (${escapeHtml(studentCode)})
              ${studentClass ? ` | Lớp: <strong>${escapeHtml(studentClass)}</strong>` : ''}
            </div>
          ` : ''}
          <small style="color:#64748b; font-size:12px;">🕒 Thời gian nộp: ${escapeHtml(submittedAt)}</small>
        </div>
        <div style="display: flex; align-items:center; gap:12px;">
          <div style="text-align:right;">
            <div style="font-size: 11px; color:#64748b; text-transform:uppercase; font-weight:600;">Điểm số</div>
            <strong style="font-size:20px; color:#16a34a;">${score} / 10</strong>
          </div>
          <button type="button" onclick="${backAction}" style="padding:8px 14px; font-size: 13px; background:#64748b; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600;">
            ⬅️ Quay lại
          </button>
        </div>
      </div>

      <div>
        ${questions.map((q, idx) => {
          const qId = String(q.id || (idx + 1));
          const userAnsRaw = studentAnswers[qId] || studentAnswers[idx + 1] || '';
          const userAnsNorm = normalizeChoice(userAnsRaw);
          const keyAnsRaw = q.correctAnswer ?? q.answerKey ?? q.answer ?? 'A';
          const keyAnsNorm = normalizeChoice(keyAnsRaw);

          const isCorrect = userAnsNorm.letter !== '' && (userAnsNorm.letter === keyAnsNorm.letter || userAnsNorm.index === keyAnsNorm.index);

          return `
            <div style="border:2px solid ${isCorrect ? '#86efac' : (userAnsNorm.letter ? '#fca5a5' : '#cbd5e1')}; border-radius:8px; padding: 14px; margin-bottom: 14px; background:#fff;">
              <div style="display: flex; justify-content:space-between; margin-bottom:8px; align-items:center;">
                <strong style="color:#0f172a; font-size: 14px;">Câu ${idx + 1}:</strong>
                <span style="font-size:12px; font-weight:700; padding:2px 8px; border-radius: 12px; background:${isCorrect ? '#dcfce7' : '#fee2e2'}; color:${isCorrect ? '#15803d' : '#dc2626'};">
                  ${isCorrect ? '✅ Đúng' : (userAnsNorm.letter ? '❌ Sai' : '⚠️ Chưa làm')}
                </span>
              </div>
              <div style="margin-bottom: 10px; font-size:13px; color:#1e293b; line-height:1.5;">${escapeHtml(q.stem || q.text || '')}</div>
              <div style="display: flex; flex-direction:column; gap:6px;">
                ${(q.options || []).map((opt, oIdx) => {
                  const letter = String.fromCharCode(65 + oIdx);
                  const isKey = (keyAnsNorm.letter === letter || keyAnsNorm.index === String(oIdx));
                  const isStudentChoice = (userAnsNorm.letter === letter || userAnsNorm.index === String(oIdx));

                  let labelNote = '';
                  if (isKey) labelNote = ' (Đáp án đúng)';
                  if (isStudentChoice) {
                    labelNote += isLecturerView ? ' [SV chọn]' : ' [Lựa chọn của bạn]';
                  }

                  return `
                    <div style="background:${isKey ? '#dcfce7' : (isStudentChoice ? '#fee2e2' : '#f8fafc')}; border:1px solid ${isKey ? '#86efac' : (isStudentChoice ? '#fca5a5' : '#e2e8f0')}; padding:8px 12px; border-radius:6px; font-size:13px; color:#334155;">
                      <strong>${letter}.</strong> ${escapeHtml(String(opt).replace(/^[A-D][.:)]\s*/i, ''))}
                      <span style="font-weight:600; color:${isKey ? '#15803d' : (isStudentChoice ? '#dc2626' : 'transparent')};">
                        ${labelNote}
                      </span>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  container.innerHTML = html;
  if (typeof renderKaTeX === 'function') {
    setTimeout(() => renderKaTeX(container), 50);
  }
}

// Bind to Window
window.handleReviewSubmittedExam = handleReviewSubmittedExam;
window.renderExamReviewUI = renderExamReviewUI;
window.handleLoadStudentDashboard = handleLoadStudentDashboard;
window.handleStartTakeExam = handleStartTakeExam;
window.handleConfirmSubmitExam = handleConfirmSubmitExam;
window.executeSubmitExam = executeSubmitExam;