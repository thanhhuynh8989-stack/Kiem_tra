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

  // 1. Cập nhật ngay Mã SV lên thẻ hiển thị giao diện
  if (typeof renderStudentHeaderInfo === 'function') {
    renderStudentHeaderInfo();
  }

  // 2. Đọc Mã SV với cơ chế dự phòng nhiều nguồn
  let studentCode = getLoggedInUsername();
  
  if (!studentCode || studentCode === '--' || studentCode === 'N/A') {
    try {
      const raw = sessionStorage.getItem('currentUser') || sessionStorage.getItem('userSession') || localStorage.getItem('currentUser');
      if (raw) {
        const u = JSON.parse(raw);
        studentCode = String(u.studentCode || u.username || u.code || u.user || '').trim();
      }
    } catch(e) {}
  }

  // 3. Nếu vẫn không lấy được Mã SV, báo người dùng đăng nhập lại
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

  container.innerHTML = '<p style="color:#2563eb; font-size:13px;">🔄 Đang nạp danh sách bài thi...</p>';

  try {
    const res = await appsScriptService.request('GET_STUDENT_EXAMS', { 
      username: studentCode,
      studentCode: studentCode
    });
    
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

// =========================================================================
// HÀM QUY ĐỔI ĐỒNG BỘ 2 CHIỀU GIỮA CHỮ (A,B,C,D) VÀ CHỈ SỐ SỐ (0,1,2,3)
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
// HÀM NỘP BÀI VÀ TÍNH ĐIỂM BẢO MẬT CHUẨN XÁC 100%
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

    // 1. Chuẩn hóa Mã Đề Ngắn (VD: exam_75ceb91a)
    let shortExamId = String(examId || '').trim().toLowerCase()
      .replace(/\.json$/i, '').replace(/^exams\//i, '');
    const matchHex = shortExamId.match(/(exam_[a-f0-9]{8})/i);
    if (matchHex) shortExamId = matchHex[1].toLowerCase();

    // 2. Lấy danh sách câu hỏi
    const activeQuestions = (Array.isArray(questions) && questions.length > 0) 
      ? questions 
      : (window.currentActiveQuestionsForExam || []);

    const rawAnswers = (answers && Object.keys(answers).length > 0) 
      ? answers 
      : (window.currentActiveAnswersForExam || {});

    // 3. LÀM SẠCH BẢNG ĐÁP ÁN: LỌC BỎ HOÀN TOÀN CÁC PHẦN TỬ RỖNG
    const cleanAnswersMap = {};
    Object.keys(rawAnswers).forEach(key => {
      const val = rawAnswers[key];
      if (val !== undefined && val !== null) {
        const strVal = String(val).trim();
        if (strVal !== '' && strVal !== 'null' && strVal !== 'undefined') {
          cleanAnswersMap[key] = strVal;
        }
      }
    });

    // 4. TÍNH TOÁN KẾT QUẢ ĐỐI SOÁT CHÍNH XÁC
    let correctCount = 0;
    let answeredCount = 0;
    const totalQ = activeQuestions.length;

    console.log("🔍 [FE_LOG] --- BẮT ĐẦU TÍNH ĐIỂM ---");
    console.log("🔍 [FE_LOG] Clean Answers Map:", cleanAnswersMap);

    activeQuestions.forEach((q, idx) => {
      const qNum = idx + 1;
      
      // Danh sách các khóa định danh câu hỏi có thể có
      const possibleKeys = [
        String(qNum), 
        qNum, 
        q.id, 
        q.qId, 
        `q_${qNum}`, 
        `question_${qNum}`
      ];

      let studentChoice = null;
      for (const k of possibleKeys) {
        if (k !== undefined && k !== null && cleanAnswersMap[k] !== undefined) {
          studentChoice = cleanAnswersMap[k];
          break;
        }
      }

      if (studentChoice !== null) {
        answeredCount++; // Đếm chính xác số câu thực sự trả lời

        // Trích xuất đáp án đúng gốc từ câu hỏi
        let rawExpected = q.correctAnswer ?? q.answerKey ?? q.answer ?? q.correct ?? q.correct_answer;
        
        if ((rawExpected === undefined || rawExpected === null) && Array.isArray(q.options)) {
          q.options.forEach((opt, oIdx) => {
            if (typeof opt === 'object' && opt !== null && (opt.isCorrect || opt.correct)) {
              rawExpected = oIdx;
            }
          });
        }

        // Quy đổi cả Lựa chọn của SV và Đáp án gốc về cùng chuẩn Chữ & Số
        const studentNorm = normalizeChoice(studentChoice);
        const expectedNorm = normalizeChoice(rawExpected);

        let isCorrect = false;
        if (expectedNorm.letter !== '' || expectedNorm.index !== '') {
          if (studentNorm.letter === expectedNorm.letter || studentNorm.index === expectedNorm.index) {
            isCorrect = true;
          }
        }

        if (isCorrect) correctCount++;

        console.log(`🔍 [FE_LOG] Câu ${qNum}: SV chọn='${studentChoice}' (${studentNorm.letter}/${studentNorm.index}) | Đáp án đúng='${rawExpected}' (${expectedNorm.letter}/${expectedNorm.index}) => ${isCorrect ? '✅ ĐÚNG' : '❌ SAI'}`);
      }
    });

    // 5. Tính điểm Thang 10 (làm tròn 2 chữ số thập phân)
    const finalGrade = totalQ > 0 ? Number(((correctCount / totalQ) * 10).toFixed(2)) : 0;

    console.log(`📊 [FE_LOG] KẾT QUẢ: Đã làm ${answeredCount}/${totalQ} | Đúng ${correctCount}/${totalQ} | Điểm: ${finalGrade}`);

    // 6. Lấy thông tin sinh viên
    let loggedUser = {};
    try {
      loggedUser = JSON.parse(sessionStorage.getItem('currentUser') || sessionStorage.getItem('userSession') || '{}');
    } catch(e) {}

    const studentName = loggedUser.fullName || loggedUser.name || username;
    const studentClass = loggedUser.className || loggedUser.class || '';

    // 7. Gửi gói kết quả chuẩn hóa về Apps Script
    const payload = {
      examId: shortExamId, 
      username: username,
      studentCode: username,
      studentName: studentName,
      studentClass: studentClass,
      answers: cleanAnswersMap,        // Gửi mảng đáp án đã làm sạch
      correctCount: correctCount,      // Số câu đúng chuẩn
      answeredCount: answeredCount,    // Số câu đã làm chuẩn
      totalQuestions: totalQ,          // Tổng số câu
      finalGrade: finalGrade,          // Điểm số thang 10
      violationInfo: {
        violationCount: window.violationCount || 0,
        isAutoSubmitted: (window.violationCount || 0) >= 3,
        reason: (window.violationCount || 0) >= 3 ? 'Tự động nộp do vi phạm quy chế' : 'Nộp bài thi'
      }
    };

    const res = await appsScriptService.request('SUBMIT_EXAM', payload);

    // 8. Dọn dẹp bản nháp
    if (typeof ExamDraftManager !== 'undefined') {
      ExamDraftManager.clearDraft(username, examId);
      ExamDraftManager.clearDraft(username, shortExamId);
    }

    hideAppLoading();

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
