import { appsScriptService } from './services/appsScriptService.js';
import { githubService } from './services/githubService.js';
import { parseDocxFile } from './parsers/docxParser.js';
import { parsePdfFile } from './parsers/pdfParser.js';
import { renderKaTeX } from './utils/domHelper.js';
import { aiExamParserService } from './services/aiExamParserService.js';
import { examModel } from './models/examModel.js';
import { logger } from './utils/logger.js';

let currentUser = null;
let currentExamState = null; // Lưu trạng thái đề thi AI đang phân tích / duyệt
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
  document.getElementById('loadMyExamsBtn')?.addEventListener('click', handleLoadMyExams);

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
    if (viewId === 'lecturerView') {
      handleLoadMyExams(); // Tự động nạp danh sách đề thi cá nhân khi chuyển vào cổng Giảng viên
    }
  } else if (viewId === 'studentView') {
    userInfo.style.display = 'flex';
    userBadge.textContent = 'HỌC SINH';
  } else {
    userInfo.style.display = 'none';
  }
}

/**
 * Xử lý Đăng nhập phân quyền
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

/**
 * Render đề thi cho Học sinh (Nút tick radio nằm phía trước đáp án)
 */
function renderQuestions(questions = []) {
  const container = document.getElementById('questionsList');
  container.innerHTML = '';
  questions.forEach((q, index) => {
    const card = document.createElement('div');
    card.className = 'question-card';
    card.style.cssText = 'border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 16px; background: #fff;';

    let html = `<p style="font-weight: 600; font-size: 15px; margin-bottom: 12px;"><strong>Câu ${index + 1}:</strong> ${q.stem}</p>`;

    if (q.imageUrl) {
      html += `<div style="margin: 8px 0;"><img src="${q.imageUrl}" style="max-width: 100%; max-height: 200px; border-radius: 6px; border: 1px solid #e2e8f0;" /></div>`;
    }

    (q.options || []).forEach((opt, oIdx) => {
      const optKey = String.fromCharCode(65 + oIdx);
      const optText = typeof opt === 'string' ? opt : (opt?.text || opt?.content || String(opt || ''));
      const inputId = `q_${q.id}_opt_${oIdx}`;

      // Đặt ô radio tick trước nhãn A, B, C, D
      html += `
        <div style="display: flex; align-items: center; gap: 8px; margin: 8px 0; cursor: pointer;">
          <input type="radio" 
                 id="${inputId}" 
                 name="q_${q.id}" 
                 value="${optKey}" 
                 style="width: 18px; height: 18px; cursor: pointer; flex-shrink: 0;"
                 onchange="window.saveAns('${q.id}', '${optKey}')">
          <label for="${inputId}" style="cursor: pointer; font-size: 14px; line-height: 1.4;">
            <strong>${optKey}.</strong> ${optText}
          </label>
        </div>
      `;
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

/* ==========================================================================
   HÀM TIỆN ÍCH TRÍCH XUẤT ẢNH VÀ CẮT ẢNH CANVAS
   ========================================================================== */

async function extractImagesFromDocx(file) {
  if (!window.JSZip) return [];
  try {
    const zip = await JSZip.loadAsync(file);
    const images = [];
    const mediaFiles = Object.keys(zip.files).filter(fileName =>
      fileName.startsWith('word/media/') && !zip.files[fileName].dir
    );

    for (const fileName of mediaFiles) {
      const base64 = await zip.files[fileName].async('base64');
      const ext = fileName.split('.').pop().toLowerCase();
      const mimeType = (ext === 'png') ? 'image/png' : 'image/jpeg';
      images.push({ imageBase64: base64, mimeType });
    }
    return images;
  } catch (e) {
    logger.error('Lỗi trích xuất ảnh DOCX:', e);
    return [];
  }
}

async function renderPdfPageToCanvas(file, pageNum = 1) {
  if (!window.pdfjsLib) return null;
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(pageNum);

  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.height = viewport.height;
  canvas.width = viewport.width;

  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

function cropImageFromBox(sourceCanvas, box) {
  if (!box || !Array.isArray(box) || box.length !== 4) return null;

  const [ymin, xmin, ymax, xmax] = box;
  const imgWidth = sourceCanvas.width;
  const imgHeight = sourceCanvas.height;

  const cropX = Math.max(0, (xmin / 1000) * imgWidth);
  const cropY = Math.max(0, (ymin / 1000) * imgHeight);
  const cropWidth = Math.min(imgWidth - cropX, ((xmax - xmin) / 1000) * imgWidth);
  const cropHeight = Math.min(imgHeight - cropY, ((ymax - ymin) / 1000) * imgHeight);

  if (cropWidth <= 10 || cropHeight <= 10) return null;

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = cropWidth;
  cropCanvas.height = cropHeight;

  const ctx = cropCanvas.getContext('2d');
  ctx.drawImage(
    sourceCanvas,
    cropX, cropY, cropWidth, cropHeight,
    0, 0, cropWidth, cropHeight
  );

  return cropCanvas.toDataURL('image/png');
}

/**
 * Giảng viên: Phân tích tệp hoặc văn bản đề thi bằng Gemini AI
 */
async function handleProcessExamWithAI() {
  const fileInput = document.getElementById('examFileInput');
  const rawTextarea = document.getElementById('rawExamText');
  let rawText = rawTextarea?.value.trim() || '';
  let imageBase64 = null;
  let mimeType = 'image/jpeg';
  let sourceCanvas = null;

  if (fileInput?.files.length > 0) {
    const file = fileInput.files[0];
    setUploadStatus('Đang đọc tệp và trích xuất hình ảnh...', 'color: #2563eb');
    try {
      rawText = await extractTextFromFile(file);

      if (file.name.endsWith('.docx')) {
        const docxImages = await extractImagesFromDocx(file);
        if (docxImages.length > 0) {
          imageBase64 = docxImages[0].imageBase64;
          mimeType = docxImages[0].mimeType;
        }
      } else if (file.name.endsWith('.pdf')) {
        sourceCanvas = await renderPdfPageToCanvas(file, 1);
        if (sourceCanvas) {
          imageBase64 = sourceCanvas.toDataURL('image/jpeg').split(',')[1];
          mimeType = 'image/jpeg';
        }
      }
    } catch (err) {
      setUploadStatus(`Lỗi đọc tệp: ${err.message}`, 'color: #ef4444');
      return;
    }
  }

  if (!rawText && !imageBase64) {
    return alert('Vui lòng chọn tệp (.docx, .pdf) hoặc dán văn bản đề thi vào ô nhập!');
  }

  try {
    setUploadStatus('🤖 Gemini AI đang bóc tách, chuẩn hóa công thức toán & phát hiện ảnh...', 'color: #2563eb');

    const response = await appsScriptService.request('PARSE_EXAM_AI', {
      rawText,
      imageBase64,
      mimeType
    });

    if (!response.data || !response.data.questions) {
      throw new Error('Dữ liệu trả về từ AI không hợp lệ.');
    }

    let questions = response.data.questions;

    if (sourceCanvas) {
      questions = questions.map(q => {
        if (q.hasImage && q.imageBox) {
          q.imageUrl = cropImageFromBox(sourceCanvas, q.imageBox);
        }
        return q;
      });
    }

    currentExamState = examModel.createStandardExam(
      { title: 'Đề thi phân tích bởi AI' },
      questions
    );

    setUploadStatus('✅ Phân tích hoàn tất! Bạn có thể chỉnh sửa nội dung, công thức và chọn đáp án bên dưới.', 'color: #10b981');
    renderQuestionListForReview(currentExamState.questions);

  } catch (err) {
    logger.error('AI Process Error:', err);
    setUploadStatus(`❌ Lỗi AI: ${err.message}`, 'color: #ef4444');
  }
}

/**
 * Render danh sách câu hỏi AI bóc tách (Nút radio đặt phía trước lựa chọn)
 */
function renderQuestionListForReview(questions = []) {
  const reviewSection = document.getElementById('aiReviewSection');
  const container = document.getElementById('questionsReviewList');
  const summaryText = document.getElementById('reviewSummaryText');

  if (!reviewSection || !container) return;

  reviewSection.style.display = 'block';
  container.innerHTML = '';

  const needReviewCount = questions.filter(q => q.flags?.needsUserConfirmation).length;
  if (summaryText) {
    summaryText.innerHTML = `Tổng số <strong>${questions.length}</strong> câu hỏi. Có <strong>${needReviewCount}</strong> câu AI cần bạn duyệt lại.`;
  }

  questions.forEach((q, idx) => {
    const isWarning = q.flags?.needsUserConfirmation;
    const card = document.createElement('div');
    card.className = `question-card ${isWarning ? 'card-needs-review' : ''}`;
    card.style.cssText = 'border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 16px; background: #fff; width: 100%; box-sizing: border-box;';
    card.id = `review-card-${q.id}`;

    const optionsList = (Array.isArray(q.options) && q.options.length > 0) ? q.options : ['', '', '', ''];
    q.options = optionsList;

    let optionsHtml = '';
    optionsList.forEach((opt, oIdx) => {
      const optLetter = String.fromCharCode(65 + oIdx);
      const isCorrect = Number(q.correctAnswer) === oIdx;
      const optText = typeof opt === 'string' ? opt : (opt?.text || opt?.content || String(opt || ''));

      // Đặt ô radio tick lên trước ký tự A, B, C, D
      optionsHtml += `
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px; width: 100%;">
          <input type="radio" 
                 name="correct_opt_${q.id}" 
                 id="opt_radio_${q.id}_${oIdx}" 
                 value="${oIdx}" 
                 ${isCorrect ? 'checked' : ''} 
                 style="flex-shrink: 0; cursor: pointer; width: 18px; height: 18px;"
                 onchange="window.updateCorrectAnswer('${q.id}', ${oIdx})">
          <label for="opt_radio_${q.id}_${oIdx}" style="font-weight: bold; min-width: 20px; flex-shrink: 0; cursor: pointer;">${optLetter}.</label>
          <input type="text" 
                 style="flex: 1; min-width: 0; padding: 8px 12px; border: 1px solid ${isCorrect ? '#10b981' : '#d1d5db'}; border-radius: 6px; background-color: ${isCorrect ? '#f0fdf4' : '#fff'}; font-size: 14px; box-sizing: border-box;" 
                 value="${escapeHtml(optText)}" 
                 onchange="window.updateOptionText('${q.id}', ${oIdx}, this.value)">
        </div>
      `;
    });

    const imageSectionHtml = q.imageUrl ? `
      <div style="margin-top: 10px; margin-bottom: 10px;">
        <label style="display:block; font-size: 12px; color: #6b7280; margin-bottom: 4px; font-weight: 500;">Hình ảnh minh họa:</label>
        <div style="display: flex; align-items: flex-start; gap: 10px;">
          <img src="${q.imageUrl}" style="max-width: 100%; max-height: 200px; border: 1px solid #d1d5db; border-radius: 6px; padding: 4px; background: #fafafa;" />
          <button type="button" 
                  style="background: #ef4444; color: white; border: none; padding: 6px 10px; border-radius: 4px; font-size: 12px; cursor: pointer;"
                  onclick="window.removeQuestionImage('${q.id}')">🗑️ Xóa ảnh</button>
        </div>
      </div>
    ` : '';

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
        <strong style="font-size: 15px;">Câu ${idx + 1}:</strong>
        ${isWarning 
          ? `<span style="background:#fef3c7; color:#d97706; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight:600;">⚠️ AI Tự Điền / Cần Duyệt</span>` 
          : `<span style="background:#d1fae5; color:#059669; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight:600;">✓ Hoàn Thiện</span>`}
      </div>

      <div style="margin-bottom: 12px;">
        <label style="display:block; font-size: 12px; color: #6b7280; margin-bottom: 4px; font-weight: 500;">Nội dung câu hỏi:</label>
        <textarea style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-family: inherit; font-size: 14px; resize: vertical; box-sizing: border-box;" 
                  rows="2" 
                  onchange="window.updateQuestionStem('${q.id}', this.value)">${escapeHtml(q.stem || '')}</textarea>
      </div>

      ${imageSectionHtml}

      <div>
        <label style="display:block; font-size: 12px; color: #6b7280; margin-bottom: 6px; font-weight: 500;">Các phương án (Tích chọn đáp án đúng):</label>
        ${optionsHtml}
      </div>

      ${isWarning ? `
        <div style="margin-top: 12px; padding: 10px; background: #fffbeb; border-left: 4px solid #f59e0b; border-radius: 4px; font-size: 13px;">💡 <strong>Ghi chú từ AI:</strong> ${q.flags?.note || 'Kiểm tra lại phương án và đáp án đúng.'}</div>
        <button style="margin-top: 10px; background: #059669; color: white; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight: 500;" 
                onclick="window.confirmQuestionItem('${q.id}')">✓ Đã Kiểm Tra & Đúng</button>
      ` : ''}
    `;

    container.appendChild(card);
  });

  renderKaTeX(container);
}

// HANDLERS CẬP NHẬT TRẠNG THÁI GIAO DIỆN
window.updateQuestionStem = (qId, val) => {
  if (!currentExamState) return;
  const q = currentExamState.questions.find(item => item.id === qId);
  if (q) q.stem = val;
};

window.updateOptionText = (qId, optIdx, val) => {
  if (!currentExamState) return;
  const q = currentExamState.questions.find(item => item.id === qId);
  if (q && q.options) q.options[optIdx] = val;
};

window.updateCorrectAnswer = (qId, optIdx) => {
  if (!currentExamState) return;
  const q = currentExamState.questions.find(item => item.id === qId);
  if (q) {
    q.correctAnswer = parseInt(optIdx, 10);
    renderQuestionListForReview(currentExamState.questions);
  }
};

window.confirmQuestionItem = (qId) => {
  if (!currentExamState) return;
  const q = currentExamState.questions.find(item => item.id === qId);
  if (q && q.flags) {
    q.flags.needsUserConfirmation = false;
    renderQuestionListForReview(currentExamState.questions);
  }
};

window.removeQuestionImage = (qId) => {
  if (!currentExamState) return;
  const q = currentExamState.questions.find(item => item.id === qId);
  if (q) {
    q.imageUrl = null;
    q.hasImage = false;
    renderQuestionListForReview(currentExamState.questions);
  }
};

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Xuất bản đề thi (Lấy thiết lập Form, gắn Thẻ User và đăng đề)
 */
async function handlePublishExam() {
  if (!currentExamState) return alert('Chưa có dữ liệu đề thi để xuất bản!');

  const examTitle = document.getElementById('examTitleInput')?.value.trim();
  const durationMinutes = parseInt(document.getElementById('examDurationInput')?.value || '45', 10);
  const maxViolations = parseInt(document.getElementById('examMaxViolationsInput')?.value || '3', 10);

  if (!examTitle) {
    return alert('Vui lòng nhập Tên đề thi trước khi lưu!');
  }

  const unconfirmedCount = currentExamState.questions.filter(q => q.flags?.needsUserConfirmation).length;
  if (unconfirmedCount > 0) {
    const autoConfirm = confirm(`Vẫn còn ${unconfirmedCount} câu hỏi AI tự điền chưa duyệt thủ công. Bạn có muốn tiếp tục xuất bản không?`);
    if (!autoConfirm) return;
  }

  try {
    setUploadStatus('Đang tạo đề thi và gắn thẻ người dùng...', 'color: #2563eb');

    // Thiết lập thuộc tính cấu hình và thẻ User
    currentExamState.title = examTitle;
    currentExamState.durationMinutes = durationMinutes;
    currentExamState.maxViolations = maxViolations;
    currentExamState.createdBy = currentUser ? currentUser.username : 'anonymous';
    currentExamState.createdByName = currentUser ? currentUser.fullName : 'Vô danh';

    const { studentExam, masterKey } = examModel.splitExamForPublishing(currentExamState);

    const rawId = String(studentExam.examId || `exam_${Date.now()}`);
    const cleanExamCode = rawId.replace(/^exam_/, '');
    const fileNameOnGithub = `exam_${cleanExamCode.slice(0, 8)}.json`;

    await appsScriptService.saveAndPublishExam(
      studentExam.examId,
      masterKey,
      studentExam,
      `exams/${fileNameOnGithub}`
    );

    setUploadStatus(`🎉 Xuất bản thành công! Mã đề thi: <strong>${fileNameOnGithub}</strong>`, 'color: #10b981');
    alert(`Xuất bản đề thi thành công!\nMã đề: ${fileNameOnGithub}`);

    // Nạp lại danh sách đề thi của giảng viên
    handleLoadMyExams();
  } catch (err) {
    logger.error('Publish Error:', err);
    setUploadStatus(`❌ Lỗi xuất bản: ${err.message}`, 'color: #ef4444');
  }
}

/**
 * Tải danh sách đề thi do Giảng viên hiện tại tạo
 */
async function handleLoadMyExams() {
  const container = document.getElementById('myExamsListTable');
  if (!container || !currentUser) return;

  try {
    container.innerHTML = '<p style="color: #6b7280;">Đang tải danh sách đề thi...</p>';
    const res = await appsScriptService.request('GET_MY_EXAMS', { username: currentUser.username });
    const exams = res.data || [];

    if (exams.length === 0) {
      container.innerHTML = '<p style="color: #6b7280;">Bạn chưa tạo đề thi nào.</p>';
      return;
    }

    let html = `
      <table border="1" style="width:100%; border-collapse:collapse; text-align:left; font-size:14px; margin-top:10px;">
        <thead style="background:#f1f5f9;">
          <tr>
            <th style="padding:8px;">Mã Đề</th>
            <th style="padding:8px;">Tên Đề Thi</th>
            <th style="padding:8px;">Thời Gian</th>
            <th style="padding:8px;">Giới Hạn Vi Phạm</th>
            <th style="padding:8px;">Ngày Tạo</th>
          </tr>
        </thead>
        <tbody>
    `;

    exams.forEach(item => {
      html += `
        <tr>
          <td style="padding:8px;"><code>${item.examCode || item.examId}</code></td>
          <td style="padding:8px; font-weight:600;">${escapeHtml(item.title)}</td>
          <td style="padding:8px;">${item.durationMinutes || 45} phút</td>
          <td style="padding:8px;">${item.maxViolations || 3} lần</td>
          <td style="padding:8px;">${item.createdAt || 'N/A'}</td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<p style="color: #ef4444;">Lỗi tải danh sách đề thi!</p>';
  }
}

/**
 * Trích xuất văn bản từ tệp .docx hoặc .pdf
 */
async function extractTextFromFile(file) {
  let parsed;
  if (file.name.endsWith('.docx')) {
    parsed = await parseDocxFile(file);
  } else if (file.name.endsWith('.pdf')) {
    parsed = await parsePdfFile(file);
  } else {
    throw new Error('Định dạng tệp không được hỗ trợ. Chỉ nhận .docx hoặc .pdf');
  }

  if (!parsed) return '';

  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && 'value' in parsed) {
    parsed = parsed.value;
  }

  if (typeof parsed === 'string') return parsed;

  if (Array.isArray(parsed)) {
    return parsed.map((q, idx) => {
      if (typeof q === 'string') return q;

      const stemRaw = q.raw || q.stem || q.value || '';
      const stemText = typeof stemRaw === 'string' ? stemRaw : (stemRaw?.text || String(stemRaw || ''));

      let optsText = '';
      if (Array.isArray(q.options) && q.options.length > 0) {
        optsText = q.options.map((opt, oIdx) => {
          const optStr = typeof opt === 'string' ? opt : (opt?.text || opt?.content || String(opt || ''));
          const letter = String.fromCharCode(65 + oIdx);
          const cleanOpt = optStr.replace(/^[A-D]\.\s*/i, '').trim();
          return `${letter}. ${cleanOpt}`;
        }).join('\n');
      }

      return `${stemText}\n${optsText}`.trim();
    }).filter(text => text.length > 0).join('\n\n');
  }

  return String(parsed || '');
}

function setUploadStatus(text, style) {
  const el = document.getElementById('uploadStatus');
  if (el) {
    el.innerHTML = text;
    el.setAttribute('style', `margin-top: 12px; font-weight: 600; ${style}`);
  }
}
