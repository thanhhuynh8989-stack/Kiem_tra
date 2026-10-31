import { appsScriptService } from '../services/appsScriptService.js';
import { renderKaTeX } from '../utils/domHelper.js';
import { 
  getLoggedInUsername, 
  showAppLoading, 
  hideAppLoading, 
  startViolationTracking, 
  stopViolationTracking, 
  escapeHtml 
} from './authAndCore.js';

// =========================================================================
// RESET SẠCH BỘ NHỚ ĐÁP ÁN TRƯỚC KHI VÀO THI
// =========================================================================
export function resetExamSessionState() {
  window.currentActiveAnswersForExam = {};
  if (typeof userAnswers !== 'undefined') {
    for (let k in userAnswers) delete userAnswers[k];
  }
}

// =========================================================================
// 1. THUẬT TOÁN XÁO TRỘN NGUYÊN TẮC FISHER-YATES
// =========================================================================
function shuffleArray(arr) {
  const array = [...arr];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// =========================================================================
// 2. DRAFT MANAGER (LƯU BÀI DỞ, BỐ CỤC XÁO TRỘN & SỐ LẦN VI PHẠM VÀO LOCAL STORAGE)
// =========================================================================
export const ExamDraftManager = {
  getDraftKey(username, examId) {
    const cleanId = String(examId || '').trim().toLowerCase().replace(/\.json$/i, '').replace(/^exams\//i, '');
    const matchHex = cleanId.match(/(exam_[a-f0-9]{8})/i);
    const shortId = matchHex ? matchHex[1].toLowerCase() : cleanId;
    return `exam_draft_${String(username).trim().toLowerCase()}_${shortId}`;
  },
  saveDraft(username, examId, userAnswers, remainingSeconds, layout = null, violationCount = 0) {
    if (!username || !examId) return;
    const key = this.getDraftKey(username, examId);
    const existing = this.getDraft(username, examId) || {};
    localStorage.setItem(key, JSON.stringify({
      answers: userAnswers,
      remainingSeconds: remainingSeconds,
      layout: layout || existing.layout || null,
      violationCount: Number(violationCount) || 0, // Lưu vết số lần vi phạm
      updatedAt: Date.now()
    }));
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

// =========================================================================
// 3. QUY ĐỔI ĐỒNG BỘ 2 CHIỀU CHỮ (A,B,C,D) VÀ CHỈ SỐ SỐ (0,1,2,3)
// =========================================================================
function normalizeChoice(val) {
  if (val === undefined || val === null) return { letter: '', index: '' };
  const str = String(val).trim().toUpperCase();
  
  const letterToIdx = { 'A': '0', 'B': '1', 'C': '2', 'D': '3' };
  const idxToLetter = { '0': 'A', '1': 'B', '2': 'C', '3': 'D' };

  if (letterToIdx[str] !== undefined) {
    return { letter: str, index: letterToIdx[str] };
  }
  if (idxToLetter[str] !== undefined) {
    return { letter: idxToLetter[str], index: str };
  }
  return { letter: str, index: str };
}

// =========================================================================
// 4. BẢNG ĐIỀU KHIỂN & BÀI THI CỦA SINH VIÊN (STUDENT DASHBOARD)
// =========================================================================
export async function handleLoadStudentDashboard() {
  const container = document.getElementById('studentExamContainer');
  if (!container) return;

  if (typeof renderStudentHeaderInfo === 'function') {
    renderStudentHeaderInfo();
  }

  let studentCode = getLoggedInUsername();
  
  if (!studentCode || studentCode === '--' || studentCode === 'N/A') {
    try {
      const raw = sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser');
      if (raw) {
        const u = JSON.parse(raw);
        studentCode = String(u.studentCode || u.username || u.code || u.user || '').trim();
      }
    } catch(e) {}
  }

  if (!studentCode || studentCode === '--') {
    container.innerHTML = `
      <div style="text-align:center; padding:24px; background:#fff; border-radius:10px; border:1px solid #fca5a5;">
        <p style="color:#dc2626; font-weight:700; font-size:14px; margin:0 0 8px 0;">⚠️ Không tìm thấy phiên đăng nhập của Sinh viên!</p>
        <p style="color:#64748b; font-size:12px; margin:0 0 12px 0;">Vui lòng nhấn Đăng xuất và đăng nhập lại tài khoản Sinh viên.</p>
        <button type="button" onclick="location.reload()" style="background:#2563eb; color:#fff; border:none; padding:6px 16px; border-radius:6px; cursor:pointer; font-size:12px;">🔄 Tải lại trang</button>
      </div>
    `;
    return;
  }

  container.innerHTML = '<p style="color:#2563eb; font-size:13px; padding:12px;">🔄 Đang nạp danh sách bài thi...</p>';

  try {
    const res = await appsScriptService.request('GET_STUDENT_EXAMS', { 
      username: studentCode,
      studentCode: studentCode
    });
    
    const exams = res.exams || res.data || [];
    renderStudentDashboard(exams);
  } catch (err) {
    container.innerHTML = `<p style="color:#ef4444; font-size:13px; padding:12px;">⚠️ Lỗi nạp bài thi: ${escapeHtml(err.message)}</p>`;
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
    html += `<div style="grid-column:1/-1; text-align:center; padding:20px; color:var(--text-muted);">Hiện chưa có bài thi nào được giao.</div>`;
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
            <div style="font-size:12px; color:var(--text-muted);">Mã đề: ${escapeHtml(ex.examCode || ex.examId)} | ⏱️ ${ex.durationMinutes} phút</div>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid #f1f5f9; padding-top:8px;">
            <span style="font-weight:700; color:${hasScore ? '#15803d' : '#94a3b8'}; font-size:14px;">${hasScore ? `${ex.score}/10` : '--'}</span>
            ${isCompleted ? `
              <button type="button" onclick="handleReviewSubmittedExam('${escapeHtml(ex.examId)}', '${escapeHtml(ex.examCode || '')}')" style="background:#0d9488; color:#fff; border:none; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px;">👁️ Xem lại bài</button>
            ` : `
              <button type="button" onclick="handleStartTakeExam('${escapeHtml(ex.examId)}', '${escapeHtml(ex.examCode || '')}')" style="background:${hasDraft ? '#d97706' : '#2563eb'}; color:#fff; border:none; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px;">
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
// 5. KHỞI TẠO BÀI THI & XÁO TRỘN ĐỀ THI AN TOÀN
// =========================================================================
export async function handleStartTakeExam(examId, examCode = '') {
  // Dừng mọi tracking cũ còn sót lại
  stopViolationTracking();

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
      // Đánh dấu hộp thoại nội bộ để tránh trigger vi phạm khi confirm
      window.isInternalDialogActive = true;
      const wantContinue = confirm('Bạn có muốn làm tiếp bài thi dở không?');
      window.isInternalDialogActive = false;

      if (wantContinue) {
        initialAnswers = draft.answers || {};
        if (draft.remainingSeconds > 0) initialTimeSeconds = draft.remainingSeconds;
        shuffledLayout = draft.layout || null;
        initialViolationCount = Number(draft.violationCount) || 0; // Khôi phục số lần vi phạm cũ
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
    alert(`Lỗi: ${err.message}`);
  }
}

// =========================================================================
// 6. MÀN HÌNH LÀM BÀI VÀ MAPPING KHÓA DUY NHẤT
// =========================================================================
export function renderTakeExamScreen(examId, fileName, shuffledQuestions, savedAnswers = {}, totalSeconds = 2700, initialViolationCount = 0) {
  const container = document.getElementById('studentExamContainer');
  if (!container) return;

  const username = getLoggedInUsername();
  let currentAnswers = { ...savedAnswers };
  let remainingSeconds = totalSeconds;

  // Lưu draft ban đầu kèm số lần vi phạm đã tích lũy
  ExamDraftManager.saveDraft(username, examId, currentAnswers, remainingSeconds, shuffledQuestions, initialViolationCount);

  let html = `
    <div style="background:#fff; border-radius:10px; padding:16px; border:1px solid var(--border);">
      <div style="position:sticky; top:10px; z-index:100; background:#0f172a; color:#fff; padding:10px 16px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
        <span style="font-weight:600; font-size:14px;">📝 ${escapeHtml(fileName)} <small style="color:#38bdf8; margin-left:8px;">(Đã xáo trộn)</small></span>
        <div id="examTimerDisplay" style="font-size:16px; font-weight:700; color:#38bdf8;">⏱️ 00:00</div>
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
                    <label style="display:flex; align-items:center; gap:10px; background:#fff; padding:10px 12px; border-radius:6px; border:1px solid ${isChecked ? '#2563eb' : '#cbd5e1'}; cursor:pointer; font-size:13px; transition: all 0.15s ease;">
                      <input type="radio" name="take_ans_${qId}" value="${optObj.originalLetter}" ${isChecked ? 'checked' : ''} onchange="window.handleStudentSelectOption('${escapeHtml(examId)}', '${escapeHtml(qId)}', '${optObj.originalLetter}')">
                      <strong style="color:${isChecked ? '#2563eb' : '#475569'};">${visualLetter}.</strong> ${escapeHtml(optObj.text)}
                    </label>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <button type="button" onclick="handleConfirmSubmitExam('${escapeHtml(examId)}', ${shuffledQuestions.length})" style="background:#16a34a; color:#fff; font-size:15px; font-weight:600; padding:12px; border:none; border-radius:8px; width:100%; margin-top:16px; cursor:pointer;">
        🚀 Nộp Bài Thi
      </button>
    </div>
  `;

  container.innerHTML = html;

  // Render công thức toán KaTeX
  if (typeof renderKaTeX === 'function') {
    setTimeout(() => renderKaTeX(container), 50);
  }

  window.handleStudentSelectOption = function(eId, questionId, originalLetter) {
    currentAnswers[String(questionId)] = originalLetter;
    ExamDraftManager.saveDraft(username, eId, currentAnswers, remainingSeconds, shuffledQuestions, window.violationCount || 0);
  };

  // Kích hoạt giám sát vi phạm với số lần vi phạm khởi tạo từ bản nháp
  startViolationTracking(initialViolationCount);

  const timerEl = document.getElementById('examTimerDisplay');
  const timerInterval = setInterval(() => {
    remainingSeconds--;
    if (remainingSeconds % 5 === 0) {
      ExamDraftManager.saveDraft(username, examId, currentAnswers, remainingSeconds, shuffledQuestions, window.violationCount || 0);
    }

    if (remainingSeconds <= 0) {
      clearInterval(timerInterval);
      alert('⏰ Đã hết giờ làm bài! Hệ thống tự động nộp bài.');
      executeSubmitExam(examId, shuffledQuestions, currentAnswers);
      return;
    }

    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    if (timerEl) timerEl.innerText = `⏱️ ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }, 1000);

  window.activeExamTimer = timerInterval;
  window.currentActiveQuestionsForExam = shuffledQuestions;
  window.currentActiveAnswersForExam = currentAnswers;
  window.currentActiveExamId = examId;
}

// =========================================================================
// 7. XỬ LÝ NỘP BÀI THI KHI ẤN XÁC NHẬN (CÓ CẢNH BÁO CÂU CHƯA LÀM)
// =========================================================================
export async function handleConfirmSubmitExam(examId, totalQuestions) {
  const username = getLoggedInUsername();
  const draft = ExamDraftManager.getDraft(username, examId);
  const answers = draft ? draft.answers : (window.currentActiveAnswersForExam || {});
  const answeredCount = Object.keys(answers).filter(k => answers[k]).length;

  let confirmMsg = `Bạn đã hoàn thành ${answeredCount}/${totalQuestions} câu.\nBạn có chắc chắn muốn NỘP BÀI THI ngay bây giờ không?`;
  if (answeredCount < totalQuestions) {
    confirmMsg = `⚠️ CẢNH BÁO: Bạn vẫn còn ${totalQuestions - answeredCount} câu chưa trả lời!\n\n` + confirmMsg;
  }

  // Khóa tracking trước khi hiện dialog xác nhận
  window.isInternalDialogActive = true;
  const isConfirmed = confirm(confirmMsg);
  window.isInternalDialogActive = false;

  if (isConfirmed) {
    if (window.activeExamTimer) clearInterval(window.activeExamTimer);
    const questions = window.currentActiveQuestionsForExam || [];
    executeSubmitExam(examId, questions, answers);
  }
}

// =========================================================================
// 8. HÀM CHUYỂN DỮ LIỆU NỘP VỀ BACKEND CHẤM ĐIỂM (SERVER-SIDE GRADING)
// =========================================================================
export async function executeSubmitExam(
  examId = window.currentActiveExamId, 
  questions = window.currentActiveQuestionsForExam || [], 
  answers = window.currentActiveAnswersForExam || {}
) {
  showAppLoading('⏳ Đang tính điểm & gửi bài...');
  stopViolationTracking();

  try {
    const username = getLoggedInUsername();

    let shortExamId = String(examId || '').trim().toLowerCase()
      .replace(/\.json$/i, '').replace(/^exams\//i, '');
    const matchHex = shortExamId.match(/(exam_[a-f0-9]{8})/i);
    if (matchHex) shortExamId = matchHex[1].toLowerCase();

    const activeQuestions = (Array.isArray(questions) && questions.length > 0) 
      ? questions 
      : (window.currentActiveQuestionsForExam || []);

    const rawAnswers = (answers && Object.keys(answers).length > 0) 
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

    let loggedUser = {};
    try {
      loggedUser = JSON.parse(sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser') || '{}');
    } catch(e) {}

    const studentName = loggedUser.fullName || loggedUser.name || username;
    const studentClass = loggedUser.className || loggedUser.class || '';

    const payload = {
      examId: shortExamId, 
      username: username,
      studentCode: username,
      studentName: studentName,
      studentClass: studentClass,
      answers: cleanAnswersMap,
      totalQuestions: activeQuestions.length,
      violationInfo: {
        violationCount: window.violationCount || 0,
        isAutoSubmitted: (window.violationCount || 0) >= 3,
        reason: (window.violationCount || 0) >= 3 ? 'Tự động nộp do vi phạm quy chế' : 'Nộp bài thi'
      }
    };

    const res = await appsScriptService.request('SUBMIT_EXAM', payload);

    resetExamSessionState();
    if (typeof ExamDraftManager !== 'undefined') {
      ExamDraftManager.clearDraft(username, examId);
      ExamDraftManager.clearDraft(username, shortExamId);
    }

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
    } else if (typeof window.handleLoadStudentDashboard === 'function') {
      window.handleLoadStudentDashboard();
    }

  } catch (err) {
    hideAppLoading();
    alert(`Lỗi nộp bài: ${err.message}`);
  }
}

// =========================================================================
// 9. XEM LẠI BÀI THI ĐÃ NỘP (SUBMISSION REVIEW)
// =========================================================================
export async function handleReviewSubmittedExam(examId, examCode = '') {
  const username = getLoggedInUsername();
  showAppLoading('🔍 Đang tải bài làm đã nộp...');

  try {
    let rawName = String(examCode || examId).trim();
    if (rawName.includes('-')) rawName = rawName.split('-')[0];
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
          <button type="button" onclick="handleLoadStudentDashboard()" style="min-height:32px; padding:4px 10px; font-size:12px; background:#64748b; color:#fff; border:none; border-radius:6px; cursor:pointer;">↩️ Quay lại</button>
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
            <div style="border:2px solid ${isCorrect ? '#86efac' : (userAnsNorm.letter ? '#fca5a5' : '#cbd5e1')}; border-radius:8px; padding:12px; margin-bottom:12px;">
              <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                <strong>Câu ${idx + 1}:</strong>
                <span style="font-size:12px; font-weight:700; color:${isCorrect ? '#15803d' : '#dc2626'};">${isCorrect ? '✅ Đúng' : '❌ Sai'}</span>
              </div>
              <div style="margin-bottom:8px; font-size:13px;">${escapeHtml(q.stem || q.text || '')}</div>
              <div style="display:flex; flex-direction:column; gap:4px;">
                ${(q.options || []).map((opt, oIdx) => {
                  const letter = String.fromCharCode(65 + oIdx);
                  const isKey = (keyAnsNorm.letter === letter || keyAnsNorm.index === String(oIdx));
                  const isStudentChoice = (userAnsNorm.letter === letter || userAnsNorm.index === String(oIdx));
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

  if (typeof renderKaTeX === 'function') {
    setTimeout(() => renderKaTeX(container), 50);
  }
}

window.handleLoadStudentDashboard = handleLoadStudentDashboard;
window.handleStartTakeExam = handleStartTakeExam;
window.handleConfirmSubmitExam = handleConfirmSubmitExam;
window.executeSubmitExam = executeSubmitExam;
window.handleReviewSubmittedExam = handleReviewSubmittedExam;
