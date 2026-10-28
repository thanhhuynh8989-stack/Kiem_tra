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
// 2. DRAFT MANAGER (LƯU BÀI DỞ & BỐ CỤC XÁO TRỘN VÀO LOCAL STORAGE)
// =========================================================================
export const ExamDraftManager = {
  getDraftKey(username, examId) {
    return `exam_draft_${String(username).trim()}_${String(examId).trim()}`;
  },
  saveDraft(username, examId, userAnswers, remainingSeconds, layout = null) {
    if (!username || !examId) return;
    const existing = this.getDraft(username, examId) || {};
    localStorage.setItem(this.getDraftKey(username, examId), JSON.stringify({
      answers: userAnswers,
      remainingSeconds: remainingSeconds,
      layout: layout || existing.layout || null,
      updatedAt: Date.now()
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
// 3. BẢNG ĐIỀU KHIỂN & BÀI THI CỦA SINH VIÊN (STUDENT DASHBOARD)
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
              <button type="button" onclick="handleReviewSubmittedExam('${ex.examId}', '${ex.examCode}')" style="background:#0d9488; color:#fff; border:none; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px;">👁️ Xem lại bài</button>
            ` : `
              <button type="button" onclick="handleStartTakeExam('${ex.examId}', '${ex.examCode}')" style="background:${hasDraft ? '#d97706' : '#2563eb'}; color:#fff; border:none; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px;">
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
// 4. KHỞI TẠO BÀI THI & XÁO TRỘN ĐỀ THI TỰ ĐỘNG
// =========================================================================
export async function handleStartTakeExam(examId, examCode = '') {
  const username = getLoggedInUsername();
  showAppLoading('⏳ Đang tải đề thi & khởi tạo xáo trộn...');

  try {
    let rawName = String(examCode || examId).trim();
    if (!rawName.endsWith('.json')) rawName = `${rawName}.json`;

    const filePath = `exams/${rawName}`;
    const cdnUrl = `https://raw.githubusercontent.com/thanhhuynh8989-stack/Kiem_tra/main/${filePath}?v=${Date.now()}`;
    
    const res = await fetch(cdnUrl);
    if (!res.ok) throw new Error('Không thể tải file bài thi.');
    const examData = await res.json();
    const rawQuestions = examData.questions || examData;

    hideAppLoading();

    const draft = ExamDraftManager.getDraft(username, examId) || ExamDraftManager.getDraft(username, rawName);
    let initialAnswers = {};
    let initialTimeSeconds = (examData.durationMinutes || 45) * 60;
    let shuffledLayout = null;

    if (draft && confirm('Bạn có muốn làm tiếp bài thi dở không?')) {
      initialAnswers = draft.answers || {};
      if (draft.remainingSeconds > 0) initialTimeSeconds = draft.remainingSeconds;
      shuffledLayout = draft.layout || null;
    }

    // Nếu chưa có layout xáo trộn được lưu sẵn, tiến hành xáo trộn mới
    if (!shuffledLayout) {
      shuffledLayout = rawQuestions.map((q, idx) => {
        const qId = q.id || (idx + 1);
        const originalOptions = (q.options || []).map((optText, oIdx) => ({
          originalLetter: String.fromCharCode(65 + oIdx), // 0->A, 1->B, 2->C, 3->D
          text: String(optText).replace(/^[A-D][.:)]\s*/i, '')
        }));
        
        return {
          qId: qId,
          stem: q.stem || q.text || '',
          shuffledOptions: shuffleArray(originalOptions) // Xáo trộn 4 đáp án
        };
      });
      shuffledLayout = shuffleArray(shuffledLayout); // Xáo trộn thứ tự các câu hỏi
    }

    renderTakeExamScreen(examId, rawName, shuffledLayout, initialAnswers, initialTimeSeconds);
  } catch (err) {
    hideAppLoading();
    alert(`Lỗi: ${err.message}`);
  }
}

// =========================================================================
// 5. MÀN HÌNH LÀM BÀI VÀ XỬ LÝ MAPPING NGUỢC KHI CHỌN ĐÁP ÁN
// =========================================================================
export function renderTakeExamScreen(examId, fileName, shuffledQuestions, savedAnswers = {}, totalSeconds = 2700) {
  const container = document.getElementById('studentExamContainer');
  if (!container) return;

  const username = getLoggedInUsername();
  let currentAnswers = { ...savedAnswers };
  let remainingSeconds = totalSeconds;

  // Lưu bố cục xáo trộn vào Draft để F5 làm tiếp không bị đảo linh tinh
  ExamDraftManager.saveDraft(username, examId, currentAnswers, remainingSeconds, shuffledQuestions);

  let html = `
    <div style="background:#fff; border-radius:10px; padding:16px; border:1px solid var(--border);">
      <div style="position:sticky; top:10px; z-index:100; background:#0f172a; color:#fff; padding:10px 16px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
        <span style="font-weight:600; font-size:14px;">📝 ${escapeHtml(fileName)} <small style="color:#94a3b8; margin-left:8px;">(Đã xáo trộn đề)</small></span>
        <div id="examTimerDisplay" style="font-size:16px; font-weight:700; color:#38bdf8;">⏱️ 00:00</div>
      </div>

      <div>
        ${shuffledQuestions.map((q, visualIdx) => {
          const qId = q.qId;
          const selectedOriginalAns = currentAnswers[qId] || ''; // Ký tự đáp án gốc (A, B, C, D)

          return `
            <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:14px; margin-bottom:14px;">
              <strong style="color:#0f172a; font-size:14px;">Câu ${visualIdx + 1}:</strong> ${escapeHtml(q.stem)}
              
              <div style="margin-top:10px; display:flex; flex-direction:column; gap:8px;">
                ${q.shuffledOptions.map((optObj, visualOptIdx) => {
                  const visualLetter = String.fromCharCode(65 + visualOptIdx); // Nhãn hiển thị A, B, C, D
                  const isChecked = selectedOriginalAns === optObj.originalLetter; // So sánh khớp ký tự gốc

                  return `
                    <label style="display:flex; align-items:center; gap:10px; background:#fff; padding:10px 12px; border-radius:6px; border:1px solid ${isChecked ? '#2563eb' : '#cbd5e1'}; cursor:pointer; font-size:13px; transition: all 0.15s ease;">
                      <input type="radio" name="take_ans_${qId}" value="${optObj.originalLetter}" ${isChecked ? 'checked' : ''} onchange="window.handleStudentSelectOption('${examId}', '${qId}', '${optObj.originalLetter}')">
                      <strong style="color:${isChecked ? '#2563eb' : '#475569'};">${visualLetter}.</strong> ${escapeHtml(optObj.text)}
                    </label>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <button type="button" onclick="handleConfirmSubmitExam('${examId}', ${shuffledQuestions.length})" style="background:#16a34a; color:#fff; font-size:15px; font-weight:600; padding:12px; border:none; border-radius:8px; width:100%; margin-top:16px; cursor:pointer;">
        🚀 Nộp Bài Thi
      </button>
    </div>
  `;

  container.innerHTML = html;

  // Hàm xử lý chọn phương án: Lưu lại KÝ TỰ GỐC (originalLetter) tương ứng với q.id
  window.handleStudentSelectOption = function(eId, questionId, originalLetter) {
    currentAnswers[questionId] = originalLetter;
    ExamDraftManager.saveDraft(username, eId, currentAnswers, remainingSeconds, shuffledQuestions);
  };

  startViolationTracking();

  const timerEl = document.getElementById('examTimerDisplay');
  const timerInterval = setInterval(() => {
    remainingSeconds--;
    if (remainingSeconds % 5 === 0) {
      ExamDraftManager.saveDraft(username, examId, currentAnswers, remainingSeconds, shuffledQuestions);
    }

    if (remainingSeconds <= 0) {
      clearInterval(timerInterval);
      alert('⏰ Đã hết giờ! Tự động nộp bài.');
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
// 6. XỬ LÝ NỘP BÀI VÀ GỬI VỀ SERVER
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

    // 1. CHUẨN HÓA MÃ ĐỀ NGẮN
    let shortExamId = String(examId || '').trim().toLowerCase()
      .replace(/\.json$/i, '').replace(/^exams\//i, '');
    const matchHex = shortExamId.match(/^(exam_[a-f0-9]{8})/i);
    if (matchHex) shortExamId = matchHex[1];

    // 2. LẤY CÂU HỎI VÀ CÂU TRẢ LỜI (HỖ TRỢ ÉP NỘP DỘT NGỘT)
    let activeQuestions = questions.length > 0 ? questions : (window.currentActiveQuestionsForExam || []);
    let activeAnswers = Object.keys(answers).length > 0 ? answers : (window.currentActiveAnswersForExam || {});

    if (Object.keys(activeAnswers).length === 0) {
      const draft = ExamDraftManager.getDraft(username, examId) || ExamDraftManager.getDraft(username, shortExamId);
      if (draft && draft.answers) activeAnswers = draft.answers;
    }

    // 3. FRONTEND TỰ TÍNH TOÁN CÁC CHỈ SỐ KẾT QUẢ
    let correctCount = 0;
    let answeredCount = 0;
    const totalQ = activeQuestions.length > 0 ? activeQuestions.length : Object.keys(activeAnswers).length || 10;

    activeQuestions.forEach((q, idx) => {
      const qId = q.qId || q.id || (idx + 1);
      const studentChoice = activeAnswers[qId] ?? activeAnswers[idx + 1] ?? activeAnswers[`q_${idx + 1}`];

      if (studentChoice !== undefined && studentChoice !== null && String(studentChoice).trim() !== '') {
        answeredCount++;
      }

      // Xác định đáp án đúng gốc
      let keyAns = q.answerKey || q.correctAnswer || q.answer;
      if (keyAns === undefined && Array.isArray(q.shuffledOptions)) {
        const origCorrect = q.shuffledOptions.find(o => o.isCorrect || o.originalLetter === q.correctAnswer);
        if (origCorrect) keyAns = origCorrect.originalLetter;
      }

      if (studentChoice && keyAns && String(studentChoice).trim().toUpperCase() === String(keyAns).trim().toUpperCase()) {
        correctCount++;
      }
    });

    const finalGrade = Number(((correctCount / totalQ) * 10).toFixed(2));

    // 4. LẤY THÔNG TIN THÍ SINH TỪ SESSION
    let loggedUser = {};
    try {
      loggedUser = JSON.parse(sessionStorage.getItem('currentUser') || sessionStorage.getItem('userSession') || '{}');
    } catch(e) {}

    // 5. GỬI GÓI KẾT QUẢ HOÀN CHỈNH VỀ SERVER GOOGLE SHEETS
    const res = await appsScriptService.request('SUBMIT_EXAM', {
      examId: shortExamId, 
      username: username,
      studentCode: username,
      studentName: loggedUser.fullName || loggedUser.name || username,
      studentClass: loggedUser.className || loggedUser.class || '',
      answers: activeAnswers,
      correctCount: correctCount,     // Số câu đúng
      answeredCount: answeredCount,   // Số câu đã trả lời
      totalQuestions: totalQ,         // Tổng số câu trong đề
      finalGrade: finalGrade,         // Điểm thang 10
      violationInfo: {
        violationCount: window.violationCount || 0,
        isAutoSubmitted: window.violationCount >= 3,
        reason: window.violationCount >= 3 ? 'Tự động nộp do vi phạm quy chế' : 'Nộp bài thi'
      }
    });

    // 6. DỌN SẠCH BẢN NHÁP
    ExamDraftManager.clearDraft(username, examId);
    ExamDraftManager.clearDraft(username, shortExamId);

    hideAppLoading();

    alert(`🎉 Đã nộp bài thành công!\nĐiểm số: ${finalGrade} / 10\nSố câu đúng: ${correctCount}/${totalQ}\nSố câu đã làm: ${answeredCount}/${totalQ}`);
    handleLoadStudentDashboard();

  } catch (err) {
    hideAppLoading();
    alert(`Lỗi nộp bài: ${err.message}`);
  }
}

// =========================================================================
// 7. XEM LẠI BÀI THI ĐÃ NỘP (SUBMISSION REVIEW)
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
          <button type="button" onclick="handleLoadStudentDashboard()" style="min-height:32px; padding:4px 10px; font-size:12px; background:#64748b; color:#fff; border:none; border-radius:6px; cursor:pointer;">↩️ Quay lại</button>
        </div>
      </div>

      <div>
        ${questions.map((q, idx) => {
          const qId = q.id || (idx + 1);
          const userAns = String(studentAnswers[qId] || studentAnswers[idx + 1] || '').trim().toUpperCase();
          const keyAns = String(q.answerKey || q.answer || 'A').trim().toUpperCase();
          const isCorrect = userAns && userAns === keyAns;

          return `
            <div style="border:2px solid ${isCorrect ? '#86efac' : (userAns ? '#fca5a5' : '#cbd5e1')}; border-radius:8px; padding:12px; margin-bottom:12px;">
              <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                <strong>Câu ${idx + 1}:</strong>
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

// Global scope binding
window.handleLoadStudentDashboard = handleLoadStudentDashboard;
window.handleStartTakeExam = handleStartTakeExam;
window.handleConfirmSubmitExam = handleConfirmSubmitExam;
window.executeSubmitExam = executeSubmitExam;
window.handleReviewSubmittedExam = handleReviewSubmittedExam;
