import { appsScriptService } from './services/appsScriptService.js';
import { githubService } from './services/githubService.js';
import { parseDocxFile } from './parsers/docxParser.js';
import { parsePdfFile } from './parsers/pdfParser.js';
import { renderKaTeX } from './utils/domHelper.js';
import { examModel } from './models/examModel.js';
import { logger } from './utils/logger.js';

let currentUser = null;
let currentExamData = null;
const studentAnswers = {};

document.addEventListener('DOMContentLoaded', () => {
  // Lắng nghe sự kiện chuyển trang & Đăng nhập
  document.getElementById('loginBtn').addEventListener('click', handleLogin);
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
  document.getElementById('gotoStudentBtn').addEventListener('click', () => showView('studentView'));
  document.querySelectorAll('.backToAuthLink').forEach(el => el.addEventListener('click', () => showView('authView')));

  // Logic Sinh viên
  document.getElementById('loadExamBtn').addEventListener('click', handleLoadExam);
  document.getElementById('submitExamBtn').addEventListener('click', handleSubmitExam);

  // Logic Giảng viên & Admin
  document.getElementById('processExamBtn').addEventListener('click', handleProcessFile);
  document.getElementById('loadUsersBtn').addEventListener('click', handleLoadUsers);
  document.getElementById('gotoLecturerPortalBtn').addEventListener('click', () => showView('lecturerView'));
});

/**
 * Hiển thị View theo quyền
 */
function showView(viewId) {
  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');

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
    if (res.data.authenticated) {
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
      alert(res.data.message || 'Đăng nhập thất bại!');
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
    const users = res.data;
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
 * Sinh viên: Tải đề & Nộp bài
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

function renderQuestions(questions) {
  const container = document.getElementById('questionsList');
  container.innerHTML = '';
  questions.forEach((q, index) => {
    const card = document.createElement('div');
    card.className = 'question-card';
    let html = `<p><strong>Câu ${index + 1}:</strong> ${q.stem}</p>`;
    q.options.forEach(opt => {
      html += `<div style="margin: 6px 0;">
        <label><input type="radio" name="q_${q.id}" value="${opt.key}" onchange="window.saveAns('${q.id}', '${opt.key}')"> <strong>${opt.key}.</strong> ${opt.text}</label>
      </div>`;
    });
    card.innerHTML = html;
    container.appendChild(card);
  });
}

window.saveAns = (qId, key) => { studentAnswers[qId] = key; };

async function handleSubmitExam() {
  const name = document.getElementById('studentName').value.trim();
  const code = document.getElementById('studentCode').value.trim();
  if (!name || !code) return alert('Vui lòng điền đủ thông tin!');

  try {
    const response = await appsScriptService.submitExamAnswers(currentExamData.id, { name, code }, studentAnswers);
    document.getElementById('examContainer').style.display = 'none';
    document.getElementById('resultContainer').style.display = 'block';
    document.getElementById('scoreText').textContent = `Điểm số: ${response.data.finalGrade} / 10`;
  } catch (err) {
    alert('Lỗi nộp bài!');
  }
}

/**
 * Giảng viên: Upload & Parse Đề
 */
async function handleProcessFile() {
  const fileInput = document.getElementById('examFileInput');
  const statusDiv = document.getElementById('uploadStatus');

  if (!fileInput.files.length) return alert('Vui lòng chọn 1 file đề thi!');
  const file = fileInput.files[0];
  statusDiv.textContent = 'Đang phân tích đề thi bằng Gemini AI...';

  try {
    let parsedQuestions = file.name.endsWith('.docx') ? await parseDocxFile(file) : await parsePdfFile(file);
    statusDiv.textContent = 'Đang tách Master Key và publish lên GitHub...';

    const { examId, publicData, masterKey } = examModel.splitExamAndKey({
      title: file.name.replace(/\.[^/.]+$/, ""),
      questions: parsedQuestions
    });

    const fileNameOnGithub = `exam_${examId.slice(0, 8)}.json`;
    await appsScriptService.saveAndPublishExam(examId, masterKey, publicData, `exams/${fileNameOnGithub}`);

    statusDiv.innerHTML = `<span style="color: green;">Thành công! Mã đề thi: <strong>${fileNameOnGithub}</strong></span>`;
  } catch (err) {
    statusDiv.innerHTML = `<span style="color: red;">Lỗi: ${err.message}</span>`;
  }
}
