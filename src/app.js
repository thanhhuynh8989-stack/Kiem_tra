import { appsScriptService } from './services/appsScriptService.js';
import { githubService } from './services/githubService.js';
import { parseDocxFile } from './parsers/docxParser.js';
import { parsePdfFile } from './parsers/pdfParser.js';
import { renderKaTeX } from './utils/domHelper.js';
import { aiExamParserService } from './services/aiExamParserService.js';
import { examModel } from './models/examModel.js';
import { logger } from './utils/logger.js';

let currentUser = null;
let currentExamState = null;
let currentExamData = null;
const studentAnswers = {};

let violationCount = 0;
let isExamActive = false;

// Biến quản lý Timer AI
let aiTimerInterval = null;
let aiSecondsElapsed = 0;

/**
 * Hàm chuẩn hóa dữ liệu User thông minh (Bóc tách đa tầng)
 */
function normalizeUserData(raw) {
  if (!raw) return null;

  let obj = raw;
  if (obj.data && typeof obj.data === 'object') obj = obj.data;
  if (obj.user && typeof obj.user === 'object') obj = obj.user;
  if (obj.userData && typeof obj.userData === 'object') obj = obj.userData;
  if (obj.userInfo && typeof obj.userInfo === 'object') obj = obj.userInfo;
  if (Array.isArray(obj)) obj = obj[0] || {};

  let rawRole = obj.role || obj.Role || obj.ROLE || obj.userRole || 
                raw.role || raw.Role || raw.ROLE || '';
  let normalizedRole = String(rawRole).toUpperCase().trim();

  let username = obj.username || obj.User || obj.user || 
                 raw.username || raw.User || '';
  if (typeof username === 'object') username = '';

  let fullName = obj.fullName || obj['Full name'] || obj.fullname || obj.Fullname || obj['full_name'] ||
                 obj.name || obj.Name ||
                 raw.fullName || raw['Full name'] || raw.fullname || '';

  if (typeof fullName === 'object') fullName = '';

  const knownRoles = ['ADMIN', 'LECTURER', 'STUDENT'];
  
  if (!fullName || knownRoles.includes(String(fullName).toUpperCase().trim())) {
    fullName = (username && !knownRoles.includes(String(username).toUpperCase().trim())) 
               ? username 
               : (normalizedRole === 'ADMIN' ? 'Quản trị hệ thống' : 
                  normalizedRole === 'LECTURER' ? 'Giảng viên' : 'Sinh viên');
  }

  if (!normalizedRole || !knownRoles.includes(normalizedRole)) {
    if (knownRoles.includes(String(obj.Role || raw.Role).toUpperCase().trim())) {
      normalizedRole = String(obj.Role || raw.Role).toUpperCase().trim();
    } else if (knownRoles.includes(String(username).toUpperCase().trim())) {
      normalizedRole = String(username).toUpperCase().trim();
    }
  }

  return {
    authenticated: raw.authenticated !== undefined ? raw.authenticated : true,
    username: String(username),
    fullName: String(fullName),
    role: normalizedRole
  };
}

/**
 * Gọi API có cơ chế thử lại (Retry)
 */
async function requestWithRetry(action, payload, retries = 2, delay = 1500) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await appsScriptService.request(action, payload);
    } catch (err) {
      if (attempt === retries) throw err;
      if (typeof logger !== 'undefined' && logger.warn) {
        logger.warn(`Lần thử action '${action}' thứ ${attempt + 1} thất bại. Đang thử lại...`);
      }
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

/**
 * Xử lý Đăng nhập
 */
export async function handleLogin() {
  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  const loginBtn = document.getElementById('loginBtn');

  const username = usernameInput?.value.trim();
  const password = passwordInput?.value.trim();

  if (!username || !password) {
    return alert('Vui lòng nhập đầy đủ Tên đăng nhập và Mật khẩu!');
  }

  const originalBtnText = loginBtn ? loginBtn.innerText : 'Đăng Nhập';
  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.innerText = '⏳ Đang kết nối...';
  }

  try {
    const res = await requestWithRetry('AUTH_LECTURER', { username, password });

    sessionStorage.removeItem('currentUser');
    sessionStorage.removeItem('userSession');

    currentUser = normalizeUserData(res);

    if (currentUser && currentUser.role) {
      sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
      sessionStorage.setItem('userSession', JSON.stringify(currentUser));

      alert(`Đăng nhập thành công!\nXin chào ${currentUser.fullName}!`);

      if (currentUser.role === 'ADMIN' || currentUser.role === 'LECTURER') {
        if (!document.getElementById('adminView') && !document.getElementById('lecturerView')) {
          window.location.href = 'index.html';
        } else {
          showView(currentUser.role === 'ADMIN' ? 'adminView' : 'lecturerView');
        }
      } else {
        showView('studentView');
      }
    } else {
      alert(res.message || 'Tên đăng nhập hoặc mật khẩu không chính xác!');
    }
  } catch (err) {
    console.error('Login Error:', err);
    alert('Không thể kết nối đến Máy chủ! Vui lòng kiểm tra lại đường truyền mạng.');
  } finally {
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.innerText = originalBtnText;
    }
  }
}

export function handleLogout() {
  currentUser = null;
  sessionStorage.removeItem('currentUser');
  sessionStorage.removeItem('userSession');

  if (typeof stopViolationTracking === 'function') {
    stopViolationTracking();
  }

  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  if (usernameInput) usernameInput.value = '';
  if (passwordInput) passwordInput.value = '';

  showView('authView');
}

/**
 * Hiển thị View theo quyền truy cập
 */
export function showView(viewId) {
  const targetView = document.getElementById(viewId);
  
  if (targetView) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    targetView.classList.add('active');
  }

  const userInfo = document.getElementById('userInfo');
  const userBadge = document.getElementById('userBadge');

  if (currentUser) {
    if (userInfo) userInfo.style.display = 'flex';
    
    const roleTitle = currentUser.role === 'ADMIN' ? 'Quản trị hệ thống' : 
                      currentUser.role === 'LECTURER' ? 'Giảng viên' : 'Sinh viên';

    if (userBadge) {
      userBadge.textContent = `${currentUser.fullName} (${roleTitle})`;
    }

    if (viewId === 'lecturerView' && typeof handleLoadMyExams === 'function') {
      handleLoadMyExams();
    }
  } else if (viewId === 'studentView') {
    if (userInfo) userInfo.style.display = 'flex';
    if (userBadge) userBadge.textContent = 'HỌC SINH / SINH VIÊN';
  } else {
    if (userInfo) userInfo.style.display = 'none';
  }
}

// Xuất hàm ra phạm vi Window
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.showView = showView;
window.saveAns = (qId, key) => { studentAnswers[qId] = key; };

/**
 * Gán sự kiện cho các thẻ HTML
 */
function bindEvents() {
  const rawSession = sessionStorage.getItem('currentUser') || sessionStorage.getItem('userSession');
  
  if (rawSession) {
    try {
      currentUser = normalizeUserData(JSON.parse(rawSession));

      sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
      sessionStorage.setItem('userSession', JSON.stringify(currentUser));

      const role = currentUser.role;
      if (role === 'ADMIN') {
        if (!document.getElementById('adminView') && window.location.pathname.includes('exam.html')) {
          window.location.href = 'index.html';
          return;
        }
        showView('adminView');
      } else if (role === 'LECTURER') {
        if (!document.getElementById('lecturerView') && window.location.pathname.includes('exam.html')) {
          window.location.href = 'index.html';
          return;
        }
        showView('lecturerView');
      } else {
        showView('studentView');
      }

    } catch (e) {
      console.error("Lỗi khôi phục session user:", e);
      sessionStorage.removeItem('currentUser');
      sessionStorage.removeItem('userSession');
      currentUser = null;
      showView('authView');
    }
  } else {
    showView('authView');
  }

  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) loginBtn.onclick = handleLogin;

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.onclick = handleLogout;

  const gotoStudentBtn = document.getElementById('gotoStudentBtn');
  if (gotoStudentBtn) {
    gotoStudentBtn.onclick = (e) => {
      e.preventDefault();
      showView('studentView');
    };
  }

  document.querySelectorAll('.backToAuthLink').forEach(el => {
    el.onclick = (e) => {
      e.preventDefault();
      showView('authView');
    };
  });

  document.getElementById('loadExamBtn')?.addEventListener('click', handleLoadExam);
  document.getElementById('submitExamBtn')?.addEventListener('click', () => handleSubmitExam(false));

  document.getElementById('processExamBtn')?.addEventListener('click', handleProcessExamWithAI);
  document.getElementById('publishExamBtn')?.addEventListener('click', handlePublishExam);
  document.getElementById('loadMyExamsBtn')?.addEventListener('click', handleLoadMyExams);

  document.getElementById('loadUsersBtn')?.addEventListener('click', handleLoadUsers);
  document.getElementById('gotoLecturerPortalBtn')?.addEventListener('click', () => showView('lecturerView'));
  document.getElementById('uploadStudentsBtn')?.addEventListener('click', handleUploadStudentsExcel);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindEvents);
} else {
  bindEvents();
}

async function handleLoadUsers() {
  try {
    const res = await appsScriptService.request('GET_USERS_LIST');
    const users = res.data || res || [];
    
    let html = '<table border="1" style="width:100%; border-collapse:collapse; text-align:left;"><tr><th style="padding:8px;">Username</th><th style="padding:8px;">Họ tên</th><th style="padding:8px;">Vai trò</th></tr>';
    
    const userArray = Array.isArray(users) ? users : [users];
    userArray.forEach(u => {
      const normUser = normalizeUserData(u);
      html += `<tr><td style="padding:8px;">${normUser.username}</td><td style="padding:8px;">${normUser.fullName}</td><td style="padding:8px;">${normUser.role}</td></tr>`;
    });
    
    html += '</table>';
    const usersContainer = document.getElementById('usersListTable');
    if (usersContainer) {
      usersContainer.innerHTML = html;
    }
  } catch (err) {
    console.error("Lỗi tải danh sách người dùng:", err);
    alert('Lỗi tải danh sách người dùng!');
  }
}

/* ==========================================================================
   CƠ CHẾ GIÁM SÁT VI PHẠM (RỜI TAB / BLUR TRÌNH DUYỆT)
   ========================================================================== */

function startViolationTracking() {
  violationCount = 0;
  isExamActive = true;

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('blur', handleWindowBlur);
}

function stopViolationTracking() {
  isExamActive = false;
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('blur', handleWindowBlur);
}

function handleVisibilityChange() {
  if (document.hidden && isExamActive) {
    processViolation();
  }
}

function handleWindowBlur() {
  if (isExamActive) {
    processViolation();
  }
}

function processViolation() {
  if (!isExamActive) return;
  violationCount++;

  const max = parseInt(currentExamData?.maxViolations || 3, 10);

  if (max <= 1 || violationCount >= max) {
    alert(`⚠️ VI PHẠM QUY CHẾ (${violationCount}/${max}): Bạn đã rời khỏi màn hình làm bài!\nHệ thống TỰ ĐỘNG NỘP BÀI TỨC THỜI.`);
    stopViolationTracking();
    handleSubmitExam(true);
  } else if (violationCount === max - 1) {
    alert(`⚠️ CẢNH BÁO VI PHẠM (${violationCount}/${max}): Bạn vừa rời khỏi màn hình thi!\nNếu vi phạm thêm 1 lần nữa, bài thi của bạn sẽ bị TỰ ĐỘNG NỘP NGAY LẬP TỨC.`);
  } else {
    alert(`⚠️ VI PHẠM (${violationCount}/${max}): Vui lòng không chuyển tab hoặc rời khỏi giao diện làm bài!`);
  }
}

/**
 * Sinh viên: Tải đề thi từ GitHub & Kích hoạt giám sát
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

    startViolationTracking();
  } catch (err) {
    alert('Không tìm thấy đề thi!');
  }
}

/**
 * Render đề thi cho Học sinh (Nút radio phía trước đáp án)
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

/**
 * Thu thập đáp án hiện tại và Nộp bài
 */
async function handleSubmitExam(isAutoSubmitted = false) {
  if (!currentExamData || !currentExamData.questions) {
    return alert('Không tìm thấy dữ liệu bài thi!');
  }

  const studentNameInput = document.getElementById('studentName');
  const studentCodeInput = document.getElementById('studentCode');
  
  const studentName = studentNameInput?.value.trim() || 'Thí sinh';
  const studentCode = studentCodeInput?.value.trim() || 'N/A';

  if (!isAutoSubmitted && (!studentName || !studentCode)) {
    return alert('Vui lòng điền đầy đủ Họ tên và Mã sinh viên trước khi nộp bài!');
  }

  const collectedAnswers = {};
  currentExamData.questions.forEach((q, idx) => {
    const qId = q.id || `q_${idx + 1}`;
    const selectedRadio = document.querySelector(`input[name="q_${q.id}"]:checked`) || 
                          document.querySelector(`input[name="${qId}"]:checked`) ||
                          document.querySelector(`input[name="q_${idx}"]:checked`);
    
    if (selectedRadio) {
      collectedAnswers[qId] = selectedRadio.value;
    } else if (studentAnswers[qId] !== undefined) {
      collectedAnswers[qId] = studentAnswers[qId];
    }
  });

  const btnSubmit = document.getElementById('submitExamBtn');
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.textContent = '⏳ Đang chấm điểm & gửi bài...';
  }

  stopViolationTracking();

  try {
    const examId = currentExamData.id || currentExamData.examId;
    const studentInfo = { name: studentName, code: studentCode };
    const violationInfo = {
      violationCount: violationCount,
      isAutoSubmitted: isAutoSubmitted,
      reason: isAutoSubmitted ? 'Tự động nộp do vi phạm quy chế rời màn hình' : 'Nộp bài tự nguyện'
    };

    const result = await appsScriptService.submitExamAnswers(examId, studentInfo, collectedAnswers, violationInfo);

    document.getElementById('examContainer').style.display = 'none';
    const resultContainer = document.getElementById('resultContainer');
    if (resultContainer) {
      resultContainer.style.display = 'block';
      const scoreText = document.getElementById('scoreText');
      if (scoreText) {
        scoreText.innerHTML = `
          ${isAutoSubmitted ? '<p style="color:#dc2626; font-size:16px;">⚠️ BÀI THI BỊ ÉP NỘP DO VI PHẠM MÀN HÌNH</p>' : ''}
          Điểm số: <span style="color:#2563eb; font-size:32px;">${result.data?.finalGrade || result.finalGrade || '0.00'}</span> / 10<br>
          <small style="font-size:16px; color:#475569;">(Đúng ${result.data?.score || result.score || 0}/${result.data?.totalQuestions || result.totalQuestions || 0} câu)</small>
        `;
      }
    }

  } catch (err) {
    alert('Lỗi khi nộp bài: ' + err.message);
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Nộp Bài Thi';
    }
  }
}

/* ==========================================================================
   QUẢN LÝ TIẾN TRÌNH VÀ BỘ ĐẾM THỜI GIAN AI (AI LOADING PROGRESS)
   ========================================================================== */

function startAILoading() {
  const loadingContainer = document.getElementById('aiLoadingContainer');
  const progressBar = document.getElementById('aiProgressBar');
  const timerText = document.getElementById('aiTimerText');
  const uploadStatus = document.getElementById('uploadStatus');

  if (uploadStatus) uploadStatus.innerHTML = '';
  if (loadingContainer) loadingContainer.style.display = 'block';

  aiSecondsElapsed = 0;
  if (timerText) timerText.textContent = '⏱️ 0s';
  if (progressBar) progressBar.style.width = '10%';

  clearInterval(aiTimerInterval);
  aiTimerInterval = setInterval(() => {
    aiSecondsElapsed++;
    if (timerText) timerText.textContent = `⏱️ ${aiSecondsElapsed}s`;

    if (progressBar) {
      let simulatedPercent = Math.min(90, 10 + Math.floor(aiSecondsElapsed * 2.5));
      progressBar.style.width = `${simulatedPercent}%`;
    }
  }, 1000);
}

function stopAILoading(isSuccess = true) {
  clearInterval(aiTimerInterval);
  const loadingContainer = document.getElementById('aiLoadingContainer');
  const progressBar = document.getElementById('aiProgressBar');

  if (isSuccess && progressBar) {
    progressBar.style.width = '100%';
  }

  setTimeout(() => {
    if (loadingContainer) loadingContainer.style.display = 'none';
  }, 800);
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

async function createCanvasFromBase64(base64Data, mimeType = 'image/jpeg') {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = (err) => reject(err);
    img.src = `data:${mimeType};base64,${base64Data}`;
  });
}

/**
 * LƯU GEMINI API KEY CÁ NHÂN VÀO CẢ LOCALSTORAGE VÀ GOOGLE SHEETS
 */
window.saveUserApiKey = async function() {
  const input = document.getElementById('userGeminiApiKey');
  if (!input) return;

  const apiKey = input.value.trim();
  if (!apiKey) {
    alert('Vui lòng dán Gemini API Key của bạn (bắt đầu bằng AIzaSy... hoặc AQ...).');
    return;
  }

  // 1. Lưu ngay vào LocalStorage trình duyệt để sử dụng tức thì
  localStorage.setItem('userGeminiApiKey', apiKey);
  localStorage.setItem('custom_gemini_api_key', apiKey);

  // 2. Cập nhật Badge trên giao diện
  const badge = document.getElementById('aiQuotaBadge');
  if (badge) {
    badge.style.background = '#dcfce7';
    badge.style.color = '#15803d';
    badge.innerHTML = '🔑 API Key cá nhân: Đang kích hoạt (Không giới hạn)';
  }

  // 3. Đọc Username linh hoạt từ mọi kiểu lưu trữ của currentUser
  const userObj = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const username = userObj.username || userObj.user || userObj.User || 'admin';

  try {
    const res = await appsScriptService.saveUserApiKey(username, apiKey);
    alert(res.message || 'Đã lưu API Key cá nhân thành công lên Hệ thống!');
  } catch (err) {
    console.warn('Key đã được lưu tại Trình duyệt. Đồng bộ Hệ thống thất bại:', err.message);
    alert(`Đã lưu Key tại trình duyệt! (Lưu ý đồng bộ Hệ thống: ${err.message})`);
  }
};

/**
 * TỰ ĐỘNG ĐỒNG BỘ API KEY TỪ BACKEND KHI ĐĂNG NHẬP THÀNH CÔNG
 */
function syncUserApiKeyAfterLogin(userData) {
  if (!userData) return;

  const keyInput = document.getElementById('userGeminiApiKey');
  
  if (userData.geminiApiKey) {
    localStorage.setItem('custom_gemini_api_key', userData.geminiApiKey);
    if (keyInput) keyInput.value = userData.geminiApiKey;
  } else {
    const localKey = localStorage.getItem('custom_gemini_api_key');
    if (localKey && keyInput) keyInput.value = localKey;
  }

  updateAIQuotaBadge(userData.aiUsageCount);
}

function updateAIQuotaBadge(serverUsageCount = null) {
  const badge = document.getElementById('aiQuotaBadge');
  const userKey = localStorage.getItem('custom_gemini_api_key');

  if (!badge) return;

  if (userKey) {
    badge.style.background = '#d1fae5';
    badge.style.color = '#047857';
    badge.textContent = '🔑 API Key cá nhân: Đang kích hoạt (Không giới hạn)';
  } else if (serverUsageCount !== null) {
    if (serverUsageCount >= 1) {
      badge.style.background = '#fee2e2';
      badge.style.color = '#b91c1c';
      badge.textContent = '⚠️ AI Hệ thống: 0/1 lượt (Chế độ Code thuần)';
    } else {
      badge.style.background = '#dbeafe';
      badge.style.color = '#1d4ed8';
      badge.textContent = '🎁 AI Hệ thống: 1/1 lượt miễn phí';
    }
  } else {
    badge.style.background = '#e2e8f0';
    badge.style.color = '#475569';
    badge.textContent = '🎁 AI Hệ thống: 1 lượt miễn phí (Hoặc nhập Key cá nhân)';
  }
}

async function handleProcessExamWithAI() {
  const fileInput = document.getElementById('examFileInput');
  const rawTextarea = document.getElementById('rawExamText');
  let rawText = rawTextarea?.value.trim() || '';
  let imageBase64 = null;
  let mimeType = 'image/jpeg';
  let sourceCanvas = null;
  let parsedQuestionsFromDocx = null;

  if (fileInput?.files.length > 0) {
    const file = fileInput.files[0];
    setUploadStatus('📂 Đang bóc tách tệp bằng Code thuần...', 'color: #2563eb');
    try {
      if (file.name.endsWith('.docx')) {
        parsedQuestionsFromDocx = await parseDocxFile(file);
        const docxImages = await extractImagesFromDocx(file);
        if (docxImages.length > 0) {
          imageBase64 = docxImages[0].imageBase64;
          mimeType = docxImages[0].mimeType;
          sourceCanvas = await createCanvasFromBase64(imageBase64, mimeType);
        }
      } else if (file.name.endsWith('.pdf')) {
        rawText = await extractTextFromFile(file);
        sourceCanvas = await renderPdfPageToCanvas(file, 1);
        if (sourceCanvas) {
          imageBase64 = sourceCanvas.toDataURL('image/jpeg').split(',')[1];
          mimeType = 'image/jpeg';
        }
      }
    } catch (err) {
      setUploadStatus(`❌ Lỗi đọc tệp: ${err.message}`, 'color: #ef4444');
      return;
    }
  }

  if (!rawText && !imageBase64 && (!parsedQuestionsFromDocx || parsedQuestionsFromDocx.length === 0)) {
    return alert('Vui lòng chọn tệp (.docx, .pdf) hoặc dán văn bản đề thi vào ô nhập!');
  }

  startAILoading();

  try {
    // 1. Lấy API Key cá nhân từ localStorage (Kiểm tra cả 2 tên key dự phòng)
    const customApiKey = localStorage.getItem('userGeminiApiKey') || localStorage.getItem('custom_gemini_api_key') || '';
    const username = currentUser ? currentUser.username : '';

    // 2. Gọi API Backend (Sử dụng model gemini-2.0-flash để đảm bảo tương thích 100%)
    const response = await appsScriptService.parseExamAI(
      rawText, 
      imageBase64, 
      mimeType, 
      'gemini-2.0-flash', 
      parsedQuestionsFromDocx,
      customApiKey,
      username
    );

    // 3. Bóc tách linh hoạt cấu trúc trả về từ Server (tránh lỗi undefined)
    const resData = response.data || response;
    const questionsRaw = resData.questions || (Array.isArray(resData) ? resData : null);

    if (!questionsRaw || !Array.isArray(questionsRaw)) {
      throw new Error('Dữ liệu câu hỏi trả về từ Server không hợp lệ.');
    }

    let questions = questionsRaw;

    // 4. Cập nhật lượt dùng trên Badge giao diện
    const aiUsageCount = resData.aiUsageCount !== undefined ? resData.aiUsageCount : response.aiUsageCount;
    if (aiUsageCount !== undefined && typeof updateAIQuotaBadge === 'function') {
      updateAIQuotaBadge(aiUsageCount);
    }

    // 5. Cắt ảnh từ Canvas nếu câu hỏi có cờ imageBox
    if (sourceCanvas) {
      questions = questions.map(q => {
        if (q.hasImage && q.imageBox && typeof cropImageFromBox === 'function') {
          q.imageUrl = cropImageFromBox(sourceCanvas, q.imageBox);
        }
        return q;
      });
    }

    // 6. Khởi tạo đề thi chuẩn hóa (Giữ nguyên cờ flags & originalOptionCount)
    currentExamState = examModel.createStandardExam(
      { title: 'Đề thi phân tích AI' },
      questions
    );

    stopAILoading(true);

    // 7. Đếm chính xác số câu chưa hoàn thiện (cần duyệt lại)
    const needReviewCount = currentExamState.questions.filter(q => {
      const hasEmptyOpt = Array.isArray(q.options) && q.options.some(opt => !String(opt || '').trim());
      return Boolean(q.flags?.needsUserConfirmation) || hasEmptyOpt || Boolean(q.flags?.isMissingOptions) || Boolean(q.flags?.isMissingAnswer);
    }).length;

    const isFallback = Boolean(resData.isFallback || response.isFallback);
    const serverMsg = resData.message || response.message;

    let successMsg = `✅ Hoàn tất sau ${aiSecondsElapsed}s! Bóc tách ${questions.length} câu hỏi (${needReviewCount} câu cần duyệt lại).`;
    if (isFallback) {
      successMsg = `⚠️ ${serverMsg || 'Đã dùng hết 1 lượt AI miễn phí. Hệ thống bóc tách bằng Code thuần (Vui lòng điền các ô lựa chọn bị trống).'}`;
    }

    setUploadStatus(successMsg, isFallback ? 'color: #d97706' : 'color: #10b981');
    renderQuestionListForReview(currentExamState.questions);

  } catch (err) {
    stopAILoading(false);
    if (typeof logger !== 'undefined' && logger.error) {
      logger.error('AI Process Error:', err);
    }
    setUploadStatus(`❌ Lỗi xử lý: ${err.message}`, 'color: #ef4444');
  }
}

/**
 * Render danh sách câu hỏi AI bóc tách (Ưu tiên viền cam cảnh báo cho ô trống)
 */
function renderQuestionListForReview(questions = []) {
  const reviewSection = document.getElementById('aiReviewSection');
  const container = document.getElementById('questionsReviewList');
  const summaryText = document.getElementById('reviewSummaryText');

  if (!reviewSection || !container) return;

  reviewSection.style.display = 'block';
  container.innerHTML = '';

  let needReviewCount = 0;

  questions.forEach((q, idx) => {
    const optionsList = Array.isArray(q.options) ? [...q.options] : ['', '', '', ''];
    while (optionsList.length < 4) optionsList.push('');
    q.options = optionsList.slice(0, 4);

    // 1. KIỂM TRA ĐIỀU KIỆN CẢNH BÁO
    const hasEmptyOption = q.options.some(opt => !String(opt || '').trim());
    const isMissingOpts = Boolean(q.flags?.isMissingOptions) || (q.originalOptionCount !== undefined && q.originalOptionCount < 4) || hasEmptyOption;
    const isMissingAns = Boolean(q.flags?.isMissingAnswer);
    const isWarning = Boolean(q.flags?.needsUserConfirmation) || isMissingOpts || isMissingAns;

    if (isWarning) needReviewCount++;

    const card = document.createElement('div');
    card.className = `question-card ${isWarning ? 'card-needs-review' : ''}`;
    
    const cardBorderColor = isWarning ? '#f59e0b' : '#10b981';
    const cardBgColor = isWarning ? '#fffbeb' : '#ffffff';

    card.style.cssText = `border: 2px solid ${cardBorderColor}; border-radius: 8px; padding: 16px; margin-bottom: 16px; background: ${cardBgColor}; width: 100%; box-sizing: border-box;`;
    card.id = `review-card-${q.id || `q_${idx + 1}`}`;

    let optionsHtml = '';
    q.options.forEach((opt, oIdx) => {
      const optLetter = String.fromCharCode(65 + oIdx);
      const isCorrect = Number(q.correctAnswer) === oIdx;
      const optText = typeof opt === 'string' ? opt : (opt?.text || opt?.content || String(opt || ''));
      const isEmpty = !optText.trim();

      let inputBorder = '#d1d5db';
      let inputBg = '#ffffff';

      if (isEmpty) {
        inputBorder = '#f59e0b';
        inputBg = '#fff7ed';
      } else if (isCorrect) {
        inputBorder = isMissingAns ? '#f59e0b' : '#10b981'; // Viền cam nếu tạm chọn do thiếu đáp án
        inputBg = isMissingAns ? '#fff7ed' : '#f0fdf4';
      }

      optionsHtml += `
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px; width: 100%;">
          <input type="radio" 
                 name="correct_opt_${q.id || idx}" 
                 id="opt_radio_${q.id || idx}_${oIdx}" 
                 value="${oIdx}" 
                 ${isCorrect ? 'checked' : ''} 
                 style="flex-shrink: 0; cursor: pointer; width: 18px; height: 18px;"
                 onchange="window.updateCorrectAnswer('${q.id}', ${oIdx})">
          <label for="opt_radio_${q.id || idx}_${oIdx}" style="font-weight: bold; min-width: 20px; flex-shrink: 0; cursor: pointer;">${optLetter}.</label>
          <input type="text" 
                 placeholder="${isEmpty ? '⚠️ Ô trống - Vui lòng gõ phương án ' + optLetter + '...' : ''}"
                 style="flex: 1; min-width: 0; padding: 8px 12px; border: 2px solid ${inputBorder}; border-radius: 6px; background-color: ${inputBg}; font-size: 14px; box-sizing: border-box;" 
                 value="${escapeHtml(optText)}" 
                 onchange="window.updateOptionText('${q.id}', ${oIdx}, this.value)">
        </div>
      `;
    });

    // 2. TẠO THẺ HUY HIỆU CẢNH BÁO
    let warningBadges = '';
    if (isMissingOpts) {
      warningBadges += `<span style="background:#fee2e2; color:#dc2626; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight:600; margin-left: 6px;">⚠️ Thiếu phương án</span>`;
    }
    if (isMissingAns) {
      warningBadges += `<span style="background:#fef3c7; color:#d97706; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight:600; margin-left: 6px;">⚠️ Chưa có đáp án gốc (Tạm chọn A)</span>`;
    }

    const headerBadge = isWarning 
      ? `<span style="background:#fef3c7; color:#d97706; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight:600;">⚠️ Cần xác nhận</span>`
      : `<span style="background:#d1fae5; color:#059669; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight:600;">✓ Hoàn Thiện</span>`;

    // 3. NỘI DUNG GHI CHÚ HƯỚNG DẪN
    let noteContent = q.flags?.note || '';
    if (isMissingAns) {
      noteContent = '🔍 <strong>Cảnh báo đáp án:</strong> Đề gốc chưa đánh dấu đáp án đúng (hệ thống tạm chọn A). Vui lòng tích chọn lại đáp án chuẩn xác.';
    } else if (isMissingOpts) {
      noteContent = '🔍 <strong>Ghi chú:</strong> Vui lòng điền nội dung cho các ô lựa chọn bị trống.';
    }

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
        <div>
          <strong style="font-size: 15px;">Câu ${idx + 1}:</strong>
          ${warningBadges}
        </div>
        ${headerBadge}
      </div>

      <div style="margin-bottom: 12px;">
        <label style="display:block; font-size: 12px; color: #6b7280; margin-bottom: 4px; font-weight: 500;">Nội dung câu hỏi:</label>
        <textarea style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-family: inherit; font-size: 14px; resize: vertical; box-sizing: border-box;" 
                  rows="2" 
                  onchange="window.updateQuestionStem('${q.id}', this.value)">${escapeHtml(q.stem || '')}</textarea>
      </div>

      <div>
        <label style="display:block; font-size: 12px; color: #6b7280; margin-bottom: 6px; font-weight: 500;">Các phương án (Tích chọn đáp án đúng):</label>
        ${optionsHtml}
      </div>

      ${isWarning ? `
        <div style="margin-top: 12px; padding: 10px; background: #ffffff; border: 1px solid #fcd34d; border-left: 4px solid #f59e0b; border-radius: 4px; font-size: 13px; color: #92400e;">
          ${noteContent}
        </div>
        <button type="button" 
                style="margin-top: 10px; background: #059669; color: white; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px;" 
                onclick="window.confirmQuestionItem('${q.id}')">✓ Đã Kiểm Tra & Xác Nhận</button>
      ` : ''}
    `;

    container.appendChild(card);
  });

  if (summaryText) {
    summaryText.innerHTML = `Tổng số <strong>${questions.length}</strong> câu hỏi. Có <strong style="color:#d97706;">${needReviewCount}</strong> câu thiếu đáp án gốc hoặc chưa hoàn thiện cần bạn kiểm tra.`;
  }

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

window.updateCorrectAnswer = function(qId, selectedIdx) {
  if (!currentExamState || !currentExamState.questions) return;
  const q = currentExamState.questions.find(item => String(item.id) === String(qId));
  if (q) {
    q.correctAnswer = selectedIdx;
    if (q.flags) {
      q.flags.isMissingAnswer = false;
    }
    renderQuestionListForReview(currentExamState.questions);
  }
};

window.confirmQuestionItem = function(qId) {
  if (!currentExamState || !currentExamState.questions) return;
  const q = currentExamState.questions.find(item => String(item.id) === String(qId));
  if (q) {
    const hasEmpty = q.options.some(opt => !String(opt || '').trim());
    if (hasEmpty) {
      alert('Vui lòng nhập đầy đủ 4 phương án trước khi xác nhận câu hỏi này!');
      return;
    }
    if (q.flags) {
      q.flags.needsUserConfirmation = false;
      q.flags.isMissingOptions = false;
      q.flags.isMissingAnswer = false;
    }
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
 * Xuất bản đề thi (Đã tích hợp ràng buộc kiểm tra ô trống & cuộn tới câu lỗi)
 */
async function handlePublishExam() {
  if (!currentExamState || !currentExamState.questions || currentExamState.questions.length === 0) {
    return alert('Chưa có dữ liệu đề thi để xuất bản!');
  }

  const examTitleInput = document.getElementById('examTitleInput');
  const examTitle = examTitleInput?.value.trim();
  const durationMinutes = parseInt(document.getElementById('examDurationInput')?.value || '45', 10);
  const maxViolations = parseInt(document.getElementById('examMaxViolationsInput')?.value || '3', 10);

  if (!examTitle) {
    if (examTitleInput) examTitleInput.focus();
    return alert('Vui lòng nhập Tên đề thi trước khi xuất bản!');
  }

  // 1. RÀNG BUỘC KIỂM TRA PHƯƠNG ÁN BỊ TRỐNG ("")
  let hasEmptyOption = false;
  let emptyQuestionIndex = -1;
  let emptyQuestionId = null;

  for (let idx = 0; idx < currentExamState.questions.length; idx++) {
    const q = currentExamState.questions[idx];
    const options = q.options || [];
    for (let oIdx = 0; oIdx < options.length; oIdx++) {
      const opt = options[oIdx];
      const text = typeof opt === 'string' ? opt : (opt?.text || opt?.content || '');
      if (!text || !text.trim()) {
        hasEmptyOption = true;
        emptyQuestionIndex = idx + 1;
        emptyQuestionId = q.id || `q_${idx + 1}`;
        break;
      }
    }
    if (hasEmptyOption) break;
  }

  // NẾU CÓ Ô LỰA CHỌN BỊ TRỐNG -> CHẶN XUẤT BẢN & CUỘN TỚI CÂU LỖI
  if (hasEmptyOption) {
    alert(`⚠️ KHÔNG THỂ XUẤT BẢN!\nCâu hỏi số ${emptyQuestionIndex} đang có phương án lựa chọn bị TRỐNG.\nVui lòng nhập đầy đủ nội dung cho tất cả 4 phương án trước khi xuất bản!`);
    
    const targetCard = document.getElementById(`review-card-${emptyQuestionId}`) || 
                       document.getElementById(`review-card-q_${emptyQuestionIndex}`);
    if (targetCard) {
      targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetCard.style.boxShadow = '0 0 0 3px #ef4444';
      setTimeout(() => { targetCard.style.boxShadow = 'none'; }, 3500);
    }
    return;
  }

  // 2. CẢNH BÁO CÁC CÂU CẦN GIẢNG VIÊN DUYỆT THỦ CÔNG
  const unconfirmedCount = currentExamState.questions.filter(q => q.flags?.needsUserConfirmation).length;
  if (unconfirmedCount > 0) {
    const autoConfirm = confirm(`Vẫn còn ${unconfirmedCount} câu hỏi được đánh dấu cần duyệt thủ công. Bạn có chắc chắn muốn tiếp tục xuất bản không?`);
    if (!autoConfirm) return;
  }

  // 3. THỰC HIỆN TẠO VÀ XUẤT BẢN ĐỀ THI
  try {
    setUploadStatus('⏳ Đang tạo đề thi và lưu lên kho dữ liệu...', 'color: #2563eb');

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
      `exams/${fileNameOnGithub}`,
      currentUser?.username
    );

    setUploadStatus(`🎉 Xuất bản thành công! Mã đề thi: <strong>${fileNameOnGithub}</strong>`, 'color: #10b981');
    alert(`🎉 Xuất bản đề thi thành công!\nMã đề thi: ${fileNameOnGithub}`);

    if (typeof handleLoadMyExams === 'function') {
      handleLoadMyExams();
    }
  } catch (err) {
    if (typeof logger !== 'undefined' && logger.error) {
      logger.error('Publish Error:', err);
    }
    setUploadStatus(`❌ Lỗi xuất bản: ${err.message}`, 'color: #ef4444');
  }
}

/**
 * Hàm hỗ trợ mã hóa ký tự HTML an toàn (Tránh lỗi escapeHtml is not defined)
 */
function safeEscapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 1. Hàm tải danh sách đề thi chính thức (Đã sửa lỗi đọc Username & Nút bấm)
 */
async function handleLoadMyExams() {
  console.log('🚀 [DEBUG] Kích hoạt handleLoadMyExams()');
  
  const container = document.getElementById('myExamsList');
  const btnReload = document.getElementById('loadMyExamsBtn') || 
                    document.getElementById('btnReloadExams') || 
                    document.querySelector('button[onclick*="handleLoadMyExams"]');
  
  if (btnReload) {
    btnReload.disabled = true;
    btnReload.innerText = '⏳ Đang tải...';
  }

  if (container) {
    container.innerHTML = '<p style="color: #2563eb; font-size: 13px; padding: 8px 0; font-weight: 500;">🔄 Đang kết nối lấy danh sách đề thi...</p>';
  }

  try {
    // Đọc thông tin user linh hoạt (Xử lý cả dạng Object JSON lẫn Chuỗi String)
    let userObj = {};
    const rawUser = localStorage.getItem('currentUser');
    try {
      userObj = JSON.parse(rawUser || '{}');
    } catch (e) {
      userObj = rawUser || '';
    }

    let username = '';
    if (typeof userObj === 'string') {
      username = userObj.replace(/"/g, '').trim();
    } else if (typeof userObj === 'object' && userObj !== null) {
      username = userObj.username || userObj.user || userObj.User || userObj.Fullname || userObj.name || '';
    }

    if (!username) {
      if (container) {
        container.innerHTML = '<p style="color: #ef4444; font-size: 13px;">⚠️ Chưa xác định tên tài khoản. Vui lòng đăng nhập lại.</p>';
      }
      return;
    }

    console.log('📡 Đang gửi request lấy danh sách đề thi cho user:', username);

    // Gọi API lấy danh sách từ Backend Apps Script
    const response = await appsScriptService.getLecturerExams(username);
    console.log('📦 KẾT QUẢ ĐỀ THI TỪ MÁY CHỦ:', response);

    const exams = Array.isArray(response.exams) 
      ? response.exams 
      : (Array.isArray(response.data) ? response.data : (Array.isArray(response.data?.exams) ? response.data.exams : []));

    if (!container) return;

    if (!Array.isArray(exams) || exams.length === 0) {
      container.innerHTML = `<p style="color: #64748b; font-size: 13px; padding: 8px 0;">Chưa có đề thi nào cho tài khoản <strong>${username}</strong>.</p>`;
      return;
    }

    let html = '<div style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px;">';
    exams.forEach((ex) => {
      html += `
        <div style="background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          <div>
            <strong style="font-size: 14px; color: #1e293b;">${ex.title || 'Đề thi trắc nghiệm'}</strong>
            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">
              Mã đề: <code style="background:#f1f5f9; padding:2px 6px; border-radius:4px; color:#2563eb; font-weight:600;">${ex.examCode || ex.examId}</code> 
              | Thời gian: <strong>${ex.durationMinutes || 45} phút</strong> 
              | Người tạo: <strong>${ex.createdBy || username}</strong>
              | Ngày tạo: ${ex.createdAt || 'N/A'}
            </div>
          </div>
        </div>
      `;
    });
    html += '</div>';

    container.innerHTML = html;

  } catch (err) {
    console.error('❌ Lỗi tải danh sách đề thi:', err);
    if (container) {
      container.innerHTML = `<p style="color: #ef4444; font-size: 13px;">❌ Lỗi kết nối: ${err.message}</p>`;
    }
  } finally {
    if (btnReload) {
      btnReload.disabled = false;
      btnReload.innerText = '🔄 Tải lại';
    }
  }
}

// 2. GẮN TRỰC TIẾP VÀO WINDOW
window.handleLoadMyExams = handleLoadMyExams;
window.loadMyExams = handleLoadMyExams;

// 3. SỰ KIỆN CLICK TOÀN CỤC (EVENT DELEGATION) - LẮNG NGHE NÚT BẤM DÙ XUẤT HIỆN LÚC NÀO
document.addEventListener('click', (e) => {
  const reloadBtn = e.target.closest('#loadMyExamsBtn') || 
                    e.target.closest('#btnReloadExams') || 
                    e.target.closest('button[onclick*="handleLoadMyExams"]');
  if (reloadBtn) {
    e.preventDefault();
    e.stopPropagation();
    console.log('👉 Đã nhận sự kiện click nút Tải lại!');
    handleLoadMyExams();
  }
});

// 4. TỰ ĐỘNG TẢI ĐỀ KHI GIAO DIỆN BẢNG ĐỀ THI XUẤT HIỆN
setInterval(() => {
  const container = document.getElementById('myExamsList');
  if (container && (container.children.length === 0 || container.innerHTML.trim() === '')) {
    handleLoadMyExams();
  }
}, 1200);

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

/**
 * Tải danh sách Sinh viên bằng Excel (.xlsx)
 */
async function handleUploadStudentsExcel() {
  const fileInput = document.getElementById('studentExcelInput');
  const statusEl = document.getElementById('studentUploadStatus');

  if (!fileInput || !fileInput.files.length) {
    return alert('Vui lòng chọn 1 file Excel (.xlsx) danh sách sinh viên!');
  }

  const file = fileInput.files[0];
  if (!window.XLSX) {
    return alert('Thư viện XLSX chưa tải xong. Vui lòng thử lại sau vài giây!');
  }

  if (statusEl) {
    statusEl.style.color = '#2563eb';
    statusEl.textContent = '⏳ Đang đọc file Excel...';
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(arrayBuffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rawData = window.XLSX.utils.sheet_to_json(worksheet);

    if (!rawData || rawData.length === 0) {
      throw new Error('File Excel rỗng hoặc không đúng định dạng!');
    }

    const parsedStudents = rawData.map(row => {
      const studentCode = row['Mã Sinh Viên'] || row['Mã SV'] || row['MaSV'] || row['studentCode'] || '';
      const fullName = row['Họ và Tên'] || row['Họ tên'] || row['FullName'] || row['fullName'] || '';
      const className = row['Lớp'] || row['Lop'] || row['Class'] || row['className'] || 'Chưa phân lớp';

      return { studentCode, fullName, className };
    }).filter(s => s.studentCode && s.fullName);

    if (parsedStudents.length === 0) {
      throw new Error('Không tìm thấy dữ liệu sinh viên hợp lệ. Đảm bảo file có tiêu đề cột: "Mã Sinh Viên", "Họ và Tên", "Lớp".');
    }

    if (statusEl) {
      statusEl.textContent = `⏳ Đang lưu ${parsedStudents.length} sinh viên lên Google Sheets...`;
    }

    const res = await appsScriptService.request('UPLOAD_STUDENTS_LIST', { students: parsedStudents });
    const { addedCount, skippedCount } = res.data || res;

    if (statusEl) {
      statusEl.style.color = '#10b981';
      statusEl.textContent = `✅ Thành công! Đã thêm ${addedCount} sinh viên mới (${skippedCount} mã đã tồn tại).`;
    }

    alert(`Tải lên hoàn tất!\n- Đã thêm mới: ${addedCount} sinh viên\n- Bỏ qua (trùng mã): ${skippedCount}`);
    fileInput.value = '';

  } catch (err) {
    console.error('Upload Students Error:', err);
    if (statusEl) {
      statusEl.style.color = '#ef4444';
      statusEl.textContent = `❌ Lỗi: ${err.message}`;
    }
  }
}

function setUploadStatus(text, style) {
  const el = document.getElementById('uploadStatus');
  if (el) {
    el.innerHTML = text;
    el.setAttribute('style', `margin-top: 12px; font-weight: 600; ${style}`);
  }
}
