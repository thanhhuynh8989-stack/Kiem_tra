import { appsScriptService } from './services/appsScriptService.js';
import { githubService } from './services/githubService.js';
import { parseDocxFile } from './parsers/docxParser.js';
import { parsePdfFile } from './parsers/pdfParser.js';
import { renderKaTeX } from './utils/domHelper.js';
import { aiExamParserService } from './services/aiExamParserService.js';
import { examModel } from './models/examModel.js';
import { logger } from './utils/logger.js';

let currentUser = null;
let currentExamState = null; // Lưu trạng thái đề thi AI đang phân tích
let currentExamData = null;  // Lưu đề thi sinh viên đang làm
const studentAnswers = {};

document.addEventListener('DOMContentLoaded', () => {
  // Lắng nghe sự kiện chuyển trang & Đăng nhập
  document.getElementById('loginBtn')?.addEventListener('click', handleLogin);
  document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);
  document.getElementById('gotoStudentBtn')?.addEventListener('click', () => showView('studentView'));
  document.querySelectorAll('.backToAuthLink').forEach(el => el.addEventListener('click', () => showView('authView')));

  // Logic Sinh viên
  document.getElementById('loadExamBtn')?.addEventListener('click', handleLoadExam);
  document.getElementById('submitExamBtn')?.addEventListener('click', handleSubmitExam);

  // Logic Giảng viên & AI Parsing
  document.getElementById('processExamBtn')?.addEventListener('click', handleProcessExamWithAI);
  document.getElementById('publishExamBtn')?.addEventListener('click', handlePublishExam);

  // Logic Admin
  document.getElementById('loadUsersBtn')?.addEventListener('click', handleLoadUsers);
  document.getElementById('gotoLecturerPortalBtn')?.addEventListener('click', () => showView('lecturerView'));
});

/**
 * Hiển thị View theo quyền truy cập
 */
function showView(viewId) {
  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
  document.getElementById(viewId)?.classList.add('active');

  const userInfo = document.getElementById('userInfo');
  const userBadge = document.getElementById('userBadge');

  if (currentUser) {
    userInfo.style.display = 'flex';
    userBadge.textContent = `${currentUser.fullName} (${currentUser.role})`;
  } else if (viewId === 'studentView') {
    userInfo.style.display = 'flex';
    userBadge.textContent = 'HỌC SINH';
  } else {
    userInfo.style.display = 'none';
  }
}

/**
 * Xử lý Đăng nhập phân quyền từ Google Sheet 'Users'
 */
async function handleLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value.trim();

  if (!username || !password) return alert('Vui lòng nhập tên đăng nhập và mật khẩu!');

  try {
    const res = await appsScriptService.request('AUTH_USER', { username, password });
    if (res.data?.authenticated) {
      currentUser = res.data;
      alert(`Xin chào ${currentUser.fullName}!`);

      if (currentUser.role === 'ADMIN') {
        showView('adminView');
      } else if (currentUser.role === 'LECTURER') {
        showView('lecturerView');
      } else {
        showView('studentView');
      }
    } else {
      alert(res.data?.message || 'Đăng nhập thất bại!');
    }
  } catch (err) {
    logger.error('Login Error:', err);
    alert('Lỗi kết nối xác thực Server!');
  }
}

function handleLogout() {
  currentUser = null;
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
  showView('authView');
}

/**
 * Admin: Tải danh sách tài khoản
 */
async function handleLoadUsers() {
  try {
    const res = await appsScriptService.request('GET_USERS_LIST');
    const users = res.data || [];
    let html = '<table border="1" style="width:100%; border-collapse:collapse; text-align:left;"><tr><th>Username</th><th>Họ tên</th><th>Vai trò</th></tr>';
    users.forEach(u => {
      html += `<tr><td>${u.username}</td><td>${u.fullName}</td><td>${u.role}</td></tr>`;
    });
    html += '</table>';
    document.getElementById('usersListTable').innerHTML = html;
  } catch (err) {
    alert('Lỗi tải danh sách người dùng');
  }
}

/**
 * Sinh viên: Tải đề thi từ GitHub
 */
async function handleLoadExam() {
  const code = document.getElementById('examCodeInput').value.trim();
  if (!code) return alert('Nhập mã đề thi!');

  try {
    const filename = code.endsWith('.json') ? code : `${code}.json`;
    currentExamData = await githubService.getExam(filename);

    document.getElementById('examTitle').textContent = currentExamData.title || 'Bài Thi Trực Tuyến';
    renderQuestions(currentExamData.questions);

    document.getElementById('examSearchSection').style.display = 'none';
    document.getElementById('examContainer').style.display = 'block';
    renderKaTeX(document.getElementById('questionsList'));
  } catch (err) {
    alert('Không tìm thấy đề thi!');
  }
}

function renderQuestions(questions = []) {
  const container = document.getElementById('questionsList');
  container.innerHTML = '';
  questions.forEach((q, index) => {
    const card = document.createElement('div');
    card.className = 'question-card';
    let html = `<p><strong>Câu ${index + 1}:</strong> ${q.stem}</p>`;
    (q.options || []).forEach((opt, oIdx) => {
      const optKey = String.fromCharCode(65 + oIdx);
      const optText = typeof opt === 'string' ? opt : opt.text;
      html += `<div style="margin: 6px 0;">
        <label><input type="radio" name="q_${q.id}" value="${optKey}" onchange="window.saveAns('${q.id}', '${optKey}')"> <strong>${optKey}.</strong> ${optText}</label>
      </div>`;
    });
    card.innerHTML = html;
    container.appendChild(card);
  });
}

window.saveAns = (qId, key) => { studentAnswers[qId] = key; };

/**
 * Sinh viên: Nộp bài thi
 */
async function handleSubmitExam() {
  const name = document.getElementById('studentName').value.trim();
  const code = document.getElementById('studentCode').value.trim();
  if (!name || !code) return alert('Vui lòng điền đủ thông tin!');

  try {
    const response = await appsScriptService.submitExamAnswers(currentExamData.examId || currentExamData.id, { name, code }, studentAnswers);
    document.getElementById('examContainer').style.display = 'none';
    document.getElementById('resultContainer').style.display = 'block';
    document.getElementById('scoreText').textContent = `Điểm số: ${response.data.finalGrade} / 10`;
  } catch (err) {
    alert('Lỗi nộp bài!');
  }
}

/**
 * Giảng viên: Phân tích tệp hoặc văn bản đề thi bằng Gemini AI
 */
async function handleProcessExamWithAI() {
  const fileInput = document.getElementById('examFileInput');
  const rawTextarea = document.getElementById('rawExamText');
  let rawText = rawTextarea?.value.trim() || '';

  if (fileInput?.files.length > 0) {
    const file = fileInput.files[0];
    setUploadStatus('Đang đọc nội dung tệp...', 'color: #2563eb');
    try {
      rawText = await extractTextFromFile(file);
    } catch (err) {
      setUploadStatus(`Lỗi đọc tệp: ${err.message}`, 'color: #ef4444');
      return;
    }
  }

  if (!rawText) {
    return alert('Vui lòng chọn tệp (.docx, .pdf) hoặc dán văn bản đề thi vào ô nhập!');
  }

  try {
    setUploadStatus('🤖 Gemini AI đang bóc tách, bổ sung đáp án & kiểm lỗi...', 'color: #2563eb');

    // 1. Gửi sang AI phân tích
    const aiResult = await aiExamParserService.parseAndEnrichExam(rawText);

    // 2. Chuẩn hóa qua ExamModel
    currentExamState = examModel.createStandardExam(
      { title: 'Đề thi phân tích bởi AI' },
      aiResult.questions
    );

    setUploadStatus('✅ Phân tích hoàn tất! Kiểm tra lại thông tin bên dưới.', 'color: #10b981');
    renderQuestionListForReview(currentExamState.questions);

  } catch (err) {
    logger.error('AI Process Error:', err);
    setUploadStatus(`❌ Lỗi AI: ${err.message}`, 'color: #ef4444');
  }
}

/**
 * Render danh sách câu hỏi AI vừa bóc tách kèm cờ cảnh báo duyệt
 */
function renderQuestionListForReview(questions = []) {
  const reviewSection = document.getElementById('aiReviewSection');
  const container = document.getElementById('questionsReviewList');
  const summaryText = document.getElementById('reviewSummaryText');

  if (!reviewSection || !container) return;

  reviewSection.style.display = 'block';
  container.innerHTML = '';

  const needReviewCount = questions.filter(q => q.flags?.needsUserConfirmation).length;
  summaryText.innerHTML = `Tổng số <strong>${questions.length}</strong> câu hỏi. Có <strong>${needReviewCount}</strong> câu AI cần bạn duyệt lại.`;

  questions.forEach((q, idx) => {
    const isWarning = q.flags?.needsUserConfirmation;
    const card = document.createElement('div');
    card.className = `question-card ${isWarning ? 'card-needs-review' : ''}`;
    card.id = `review-card-${q.id}`;

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <strong>Câu ${idx + 1}:</strong>
        ${isWarning 
          ? `<span class="badge-warning">⚠️ AI Tự Điền / Cần Duyệt</span>` 
          : `<span class="badge-success">✓ Hoàn Thiện</span>`}
      </div>
      <p style="margin: 8px 0; font-weight: 500;">${q.stem}</p>
      
      <div style="margin-left: 12px;">
        ${(q.options || []).map((opt, oIdx) => `
          <div style="${q.correctAnswer === oIdx ? 'color: #059669; font-weight: bold;' : ''}">
            ${String.fromCharCode(65 + oIdx)}. ${opt} ${q.correctAnswer === oIdx ? '✓ (Đáp án)' : ''}
          </div>
        `).join('')}
      </div>

      ${isWarning ? `
        <div class="ai-note">💡 <strong>Ghi chú từ AI:</strong> ${q.flags?.note || 'Kiểm tra lại phương án và đáp án đúng.'}</div>
        <button class="btn-confirm" onclick="window.confirmQuestionItem('${q.id}')">✓ Đã Kiểm Tra & Đúng</button>
      ` : ''}
    `;

    container.appendChild(card);
  });

  renderKaTeX(container);
}

/**
 * Đánh dấu đã kiểm tra xong 1 câu hỏi
 */
window.confirmQuestionItem = function(questionId) {
  if (!currentExamState) return;
  const q = currentExamState.questions.find(item => item.id === questionId);
  if (q && q.flags) {
    q.flags.needsUserConfirmation = false;
    renderQuestionListForReview(currentExamState.questions);
  }
};

/**
 * Xuất bản đề thi (Tách Master Key và đẩy dữ liệu lên Cloud/GitHub)
 */
async function handlePublishExam() {
  if (!currentExamState) return;

  const unconfirmedCount = currentExamState.questions.filter(q => q.flags?.needsUserConfirmation).length;
  if (unconfirmedCount > 0) {
    const autoConfirm = confirm(`Vẫn còn ${unconfirmedCount} câu hỏi AI tự điền chưa duyệt thủ công. Bạn có muốn tiếp tục xuất bản không?`);
    if (!autoConfirm) return;
  }

  try {
    setUploadStatus('Đang phân tách Master Key và đăng đề lên GitHub...', 'color: #2563eb');
    
    // Tách đề thi thành bản dành cho Học sinh & Bảng đáp án Master Key
    const { studentExam, masterKey } = examModel.splitExamForPublishing(currentExamState);
    const fileNameOnGithub = `exam_${studentExam.examId.slice(0, 8)}.json`;

    await appsScriptService.saveAndPublishExam(
      studentExam.examId,
      masterKey,
      studentExam,
      `exams/${fileNameOnGithub}`
    );

    setUploadStatus(`🎉 Xuất bản thành công! Mã đề thi: <strong>${fileNameOnGithub}</strong>`, 'color: #10b981');
    alert(`Xuất bản đề thi thành công! Mã đề: ${fileNameOnGithub}`);
  } catch (err) {
    logger.error('Publish Error:', err);
    setUploadStatus(`❌ Lỗi xuất bản: ${err.message}`, 'color: #ef4444');
  }
}

/**
 * Đọc nội dung tệp .docx hoặc .pdf
 */
async function extractTextFromFile(file) {
  if (file.name.endsWith('.docx')) {
    const parsed = await parseDocxFile(file);
    return Array.isArray(parsed) ? parsed.map(q => q.raw || q.stem).join('\n') : parsed;
  } else if (file.name.endsWith('.pdf')) {
    const parsed = await parsePdfFile(file);
    return Array.isArray(parsed) ? parsed.map(q => q.raw || q.stem).join('\n') : parsed;
  }
  throw new Error('Định dạng tệp không được hỗ trợ. Chỉ nhận .docx hoặc .pdf');
}

function setUploadStatus(text, style) {
  const el = document.getElementById('uploadStatus');
  if (el) {
    el.innerHTML = text;
    el.setAttribute('style', `margin-top: 12px; font-weight: 600; ${style}`);
  }
}
