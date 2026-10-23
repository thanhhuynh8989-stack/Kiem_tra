import { appsScriptService } from '../services/appsScriptService.js';
import { 
  getLoggedInUsername, 
  showAppLoading, 
  hideAppLoading, 
  startViolationTracking, 
  stopViolationTracking, 
  escapeHtml 
} from './authAndCore.js';

// =========================================================================
// 1. DRAFT MANAGER (TỰ ĐỘNG LƯU BÀI DỞ VÀO LOCAL STORAGE)
// =========================================================================
export const ExamDraftManager = {
  getDraftKey(username, examId) {
    return `exam_draft_${String(username).trim()}_${String(examId).trim()}`;
  },
  saveDraft(username, examId, userAnswers, remainingSeconds) {
    if (!username || !examId) return;
    localStorage.setItem(this.getDraftKey(username, examId), JSON.stringify({
      answers: userAnswers, remainingSeconds, updatedAt: Date.now()
    }));
  },
  getDraft(username, examId) {
    if (!username || !examId) return null;
    const item = localStorage.getItem(this.getDraftKey(username, examId));
    return item ? JSON.parse(item) : null;
  },
  clearDraft(username, examId) {
    if (username && examId) localStorage.removeItem(this.getDraftKey(username, examId));
  }
};

// =========================================================================
// 2. BẢNG ĐIỀU KHIỂN & BÀI THI CỦA SINH VIÊN (STUDENT DASHBOARD)
// =========================================================================
export async function handleLoadStudentDashboard() {
  const container = document.getElementById('studentExamContainer');
  if (!container) return;
  const username = getLoggedInUsername();

  container.innerHTML = '<p style="color:#2563eb; font-size:13px;">🔄 Đang nạp danh sách bài thi...</p>';

  try {
    const res = await appsScriptService.request('GET_STUDENT_EXAMS', { username });
    const exams = res.exams || res.data || [];
    renderStudentDashboard(exams);
  } catch (err) {
    container.innerHTML = `<p style="color:#ef4444; font-size:13px;">Lỗi nạp bài thi: ${err.message}</p>`;
  }
}

export function renderStudentDashboard(exams = []) {
  const container = document.getElementById('studentExamContainer');
  if (!container) return;
  const username = getLoggedInUsername();

  let html = `<div style="background:#fff; border:1px solid var(--border); border-radius:10px; padding:16px;">
    <h3 style="margin:0 0 12px 0; font-size:16px; color:#0f172a;">📝 Danh Sách Bài Thi Được Gán (${exams.length})</h3>
    <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap:12px;">
  `;

  if (exams.length === 0) {
    html += `<div style="grid-column:1/-1; text-align:center; padding:20px; color:var(--text-muted);">Hiện chưa có bài thi nào.</div>`;
  } else {
    exams.forEach(ex => {
      const hasScore = ex.score !== null && ex.score !== undefined && ex.score !== '';
      const isCompleted = ex.isCompleted || hasScore;
      
      const draft = ExamDraftManager.getDraft(username, ex.examId) || ExamDraftManager.getDraft(username, ex.examCode);
      const hasDraft = !isCompleted && draft && Object.keys(draft.answers || {}).length > 0;

      html += `
        <div style="border:1px solid ${isCompleted ? '#bbf7d0' : (hasDraft ? '#fde68a' : '#cbd5e1')}; border-radius:8px; padding:12px; display:flex; flex-direction:column; justify-content:space-between; gap:8px;">
          <div>
            <strong style="font-size:14px; color:#0f172a;">${escapeHtml(ex.title)}</strong>
            <div style="font-size:12px; color:var(--text-muted);">Mã đề: ${ex.examCode || ex.examId} | ⏱️ ${ex.durationMinutes} phút</div>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid #f1f5f9; padding-top:8px;">
            <span style="font-weight:700; color:${hasScore ? '#15803d' : '#94a3b8'}; font-size:14px;">${hasScore ? `${ex.score}/10` : '--'}</span>
            ${isCompleted ? `
              <button type="button" onclick="handleReviewSubmittedExam('${ex.examId}', '${ex.examCode}')" style="background:#0d9488; min-height:32px; padding:4px 10px; font-size:12px; color:#fff; border:none; border-radius:6px; cursor:pointer;">👁️ Xem lại bài</button>
            ` : `
              <button type="button" onclick="handleStartTakeExam('${ex.examId}', '${ex.examCode}')" style="background:${hasDraft ? '#d97706' : '#2563eb'}; min-height:32px; padding:4px 10px; font-size:12px; color:#fff; border:none; border-radius:6px; cursor:pointer;">
                ${hasDraft ? '🔄 Làm tiếp' : '✍️ Làm bài'}
              </button>
            `}
          </div>
        </div>
      `;
    });
  }
  html += `</div></div>`;
  container.innerHTML = html;
}

// =========================================================================
// 3. MÀN HÌNH LÀM BÀI & ĐỒNG HỒ ĐẾM NGƯỢC
// =========================================================================
export async function handleStartTakeExam(examId, examCode = '') {
  const username = getLoggedInUsername();
  showAppLoading('⏳ Đang tải bài thi...');

  try {
    let rawName = String(examCode || examId).trim();
    if (!rawName.endsWith('.json')) rawName = `${rawName}.json`;

    const filePath = `exams/${rawName}`;
    const cdnUrl = `https://raw.githubusercontent.com/thanhhuynh8989-stack/Kiem_tra/main/${filePath}?v=${Date.now()}`;
    
    const res = await fetch(cdnUrl);
    if (!res.ok) throw new Error('Không thể tải file bài thi.');
    const examData = await res.json();
    const questions = examData.questions || examData;

    hideAppLoading();

    const draft = ExamDraftManager.getDraft(username, examId);
    let initialAnswers = {};
    let initialTimeSeconds = (examData.durationMinutes || 45) * 60;

    if (draft && confirm('Bạn có muốn làm tiếp bài thi dở không?')) {
      initialAnswers = draft.answers || {};
      if (draft.remainingSeconds > 0) initialTimeSeconds = draft.remainingSeconds;
    }

    renderTakeExamScreen(examId, rawName, questions, initialAnswers, initialTimeSeconds);
  } catch (err) {
    hideAppLoading();
    alert(`Lỗi: ${err.message}`);
  }
}

export function renderTakeExamScreen(examId, fileName, questions, savedAnswers = {}, totalSeconds = 2700) {
  const container = document.getElementById('studentExamContainer');
  if (!container) return;

  const username = getLoggedInUsername();
  let currentAnswers = { ...savedAnswers };
  let remainingSeconds = totalSeconds;

  let html = `
    <div style="background:#fff; border-radius:10px; padding:16px; border:1px solid var(--border);">
      <div style="position:sticky; top:10px; z-index:100; background:#0f172a; color:#fff; padding:10px 16px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <span style="font-weight:600; font-size:14px;">📝 ${escapeHtml(fileName)}</span>
        <div id="examTimerDisplay" style="font-size:16px; font-weight:700; color:#38bdf8;">⏱️ 00:00</div>
      </div>

      <div>
        ${questions.map((q, idx) => {
          const selectedAns = currentAnswers[idx + 1] || '';
          return `
            <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:12px; margin-bottom:12px;">
              <strong style="color:#0f172a;">Câu ${idx + 1}:</strong> ${escapeHtml(q.stem || q.text || '')}
              <div style="margin-top:8px; display:flex; flex-direction:column; gap:6px;">
                ${(q.options || []).map((opt, oIdx) => {
                  const letter = String.fromCharCode(65 + oIdx);
                  const isChecked = selectedAns === letter;
                  return `
                    <label style="display:flex; align-items:center; gap:8px; background:#fff; padding:8px; border-radius:6px; border:1px solid ${isChecked ? '#2563eb' : '#cbd5e1'}; cursor:pointer;">
                      <input type="radio" name="take_ans_${idx}" value="${letter}" ${isChecked ? 'checked' : ''} onchange="window.handleStudentSelectOption('${examId}', ${idx + 1}, '${letter}')">
                      <strong>${letter}.</strong> ${escapeHtml(String(opt).replace(/^[A-D][.:)]\s*/i, ''))}
                    </label>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <button type="button" onclick="handleConfirmSubmitExam('${examId}', ${questions.length})" style="background:#16a34a; width:100%; margin-top:16px;">
        🚀 Nộp Bài Thi
      </button>
    </div>
  `;

  container.innerHTML = html;

  window.handleStudentSelectOption = function(eId, qNum, letter) {
    currentAnswers[qNum] = letter;
    ExamDraftManager.saveDraft(username, eId, currentAnswers, remainingSeconds);
  };

  startViolationTracking();

  const timerEl = document.getElementById('examTimerDisplay');
  const timerInterval = setInterval(() => {
    remainingSeconds--;
    if (remainingSeconds % 5 === 0) {
      ExamDraftManager.saveDraft(username, examId, currentAnswers, remainingSeconds);
    }

    if (remainingSeconds <= 0) {
      clearInterval(timerInterval);
      alert('⏰ Đã hết giờ! Tự động nộp bài.');
      executeSubmitExam(examId, questions, currentAnswers);
      return;
    }

    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    if (timerEl) timerEl.innerText = `⏱️ ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }, 1000);

  window.activeExamTimer = timerInterval;
  window.currentActiveQuestionsForExam = questions;
  window.currentActiveAnswersForExam = currentAnswers;
  window.currentActiveExamId = examId;
}

// =========================================================================
// 4. XỬ LÝ NỘP BÀI VÀ TÍNH ĐIỂM
// =========================================================================
export async function handleConfirmSubmitExam(examId, totalQuestions) {
  if (confirm(`Bạn có chắc chắn muốn NỘP BÀI THI ngay bây giờ?`)) {
    if (window.activeExamTimer) clearInterval(window.activeExamTimer);
    const username = getLoggedInUsername();
    const draft = ExamDraftManager.getDraft(username, examId);
    const questions = window.currentActiveQuestionsForExam || [];
    const answers = draft ? draft.answers : (window.currentActiveAnswersForExam || {});
    executeSubmitExam(examId, questions, answers);
  }
}

export async function executeSubmitExam(
  examId = window.currentActiveExamId, 
  questions = window.currentActiveQuestionsForExam || [], 
  answers = window.currentActiveAnswersForExam || {}
) {
  showAppLoading('⏳ Đang tính điểm & gửi bài...');
  stopViolationTracking();

  try {
    const username = getLoggedInUsername();
    let correctCount = 0;

    questions.forEach((q, idx) => {
      const qNum = idx + 1;
      const userAns = String(answers[qNum] || '').trim().toUpperCase();
      const keyAns = String(q.answerKey || q.answer || '').trim().toUpperCase();
      if (userAns && userAns === keyAns) correctCount++;
    });

    const totalQ = questions.length || 1;
    const finalScore = Math.round((correctCount / totalQ) * 10 * 10) / 10;

    await appsScriptService.request('SUBMIT_EXAM', {
      examId: examId, 
      username: username, 
      score: finalScore, 
      answers: answers
    });

    // Dọn dẹp tất cả các dạng khóa Draft (cả mã đầy đủ lẫn mã ngắn)
    ExamDraftManager.clearDraft(username, examId);
    if (window.currentActiveExamCode) {
      ExamDraftManager.clearDraft(username, window.currentActiveExamCode);
    }

    hideAppLoading();

    alert(`🎉 Đã nộp bài thành công!\nĐiểm số: ${finalScore} / 10`);
    handleLoadStudentDashboard();
  } catch (err) {
    hideAppLoading();
    alert(`Lỗi nộp bài: ${err.message}`);
  }
}

// =========================================================================
// 5. XEM LẠI BÀI THI ĐÃ NỘP (SUBMISSION REVIEW)
// =========================================================================
export async function handleReviewSubmittedExam(examId, examCode = '') {
  const username = getLoggedInUsername();
  showAppLoading('🔍 Đang tải bài làm đã nộp...');

  try {
    let rawName = String(examCode || examId).trim();
    if (!rawName.endsWith('.json')) rawName = `${rawName}.json`;

    const filePath = `exams/${rawName}`;
    const cdnUrl = `https://raw.githubusercontent.com/thanhhuynh8989-stack/Kiem_tra/main/${filePath}?v=${Date.now()}`;
    
    const resExam = await fetch(cdnUrl);
    const examData = await resExam.json();
    const questions = examData.questions || examData;

    const resSub = await appsScriptService.request('GET_SUBMISSION_DETAIL', { examId, username });
    hideAppLoading();

    renderExamReviewUI(rawName, questions, resSub.answers || {}, resSub.score, resSub.submittedAt);
  } catch (err) {
    hideAppLoading();
    alert(`Lỗi: ${err.message}`);
  }
}

export function renderExamReviewUI(fileName, questions, studentAnswers, score, submittedAt) {
  const container = document.getElementById('studentExamContainer');
  if (!container) return;

  let html = `
    <div style="background:#fff; border-radius:10px; padding:16px; border:1px solid var(--border);">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:16px; background:#f8fafc; padding:12px; border-radius:8px;">
        <div>
          <h4 style="margin:0;">👁️ Bài làm: ${escapeHtml(fileName)}</h4>
          <small style="color:var(--text-muted);">Nộp lúc: ${submittedAt || '--'}</small>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <strong style="font-size:18px; color:#15803d;">${score} / 10</strong>
          <button type="button" onclick="handleLoadStudentDashboard()" style="min-height:32px; padding:4px 10px; font-size:12px;">↩️ Quay lại</button>
        </div>
      </div>

      <div>
        ${questions.map((q, idx) => {
          const qNum = idx + 1;
          const userAns = String(studentAnswers[qNum] || '').trim().toUpperCase();
          const keyAns = String(q.answerKey || q.answer || '').trim().toUpperCase();
          const isCorrect = userAns && userAns === keyAns;

          return `
            <div style="border:2px solid ${isCorrect ? '#86efac' : (userAns ? '#fca5a5' : '#cbd5e1')}; border-radius:8px; padding:12px; margin-bottom:12px;">
              <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                <strong>Câu ${qNum}:</strong>
                <span style="font-size:12px; font-weight:700; color:${isCorrect ? '#15803d' : '#dc2626'};">${isCorrect ? '✅ Đúng' : '❌ Sai'}</span>
              </div>
              <div style="margin-bottom:8px; font-size:13px;">${escapeHtml(q.stem || q.text || '')}</div>
              <div style="display:flex; flex-direction:column; gap:4px;">
                ${(q.options || []).map((opt, oIdx) => {
                  const letter = String.fromCharCode(65 + oIdx);
                  const isKey = keyAns === letter;
                  const isStudentChoice = userAns === letter;
                  return `
                    <div style="background:${isKey ? '#dcfce7' : (isStudentChoice ? '#fee2e2' : '#fff')}; border:1px solid ${isKey ? '#86efac' : '#e2e8f0'}; padding:6px 10px; border-radius:4px; font-size:12px;">
                      <strong>${letter}.</strong> ${escapeHtml(String(opt).replace(/^[A-D][.:)]\s*/i, ''))} ${isKey ? ' (Đáp án đúng)' : (isStudentChoice ? ' (Lựa chọn của bạn)' : '')}
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
}

// Bán các hàm ra Window toàn cục để phục vụ gọi trực tiếp từ HTML onclick
window.handleLoadStudentDashboard = handleLoadStudentDashboard;
window.handleStartTakeExam = handleStartTakeExam;
window.handleConfirmSubmitExam = handleConfirmSubmitExam;
window.executeSubmitExam = executeSubmitExam;
window.handleReviewSubmittedExam = handleReviewSubmittedExam;
