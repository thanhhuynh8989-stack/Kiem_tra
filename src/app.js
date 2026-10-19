import { appsScriptService } from './services/appsScriptService.js';
import { githubService } from './services/githubService.js';
import { parseDocxFile } from './parsers/docxParser.js';
import { parsePdfFile } from './parsers/pdfParser.js';
import { renderKaTeX } from './utils/domHelper.js';
import { aiExamParserService } from './services/aiExamParserService.js';
import { examModel } from './models/examModel.js';
import { logger } from './utils/logger.js';
import { APP_CONFIG } from './constants/appConfig.js';

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
 * Trích xuất tên Username đăng nhập từ mọi vị trí Storage có thể
 */
function getLoggedInUsername() {
  const possibleKeys = ['currentUser', 'user', 'loggedInUser', 'username', 'auth_user', 'account'];
  
  for (const key of possibleKeys) {
    // Quét cả localStorage lẫn sessionStorage
    const rawVal = localStorage.getItem(key) || sessionStorage.getItem(key);
    if (!rawVal) continue;

    try {
      const parsed = JSON.parse(rawVal);
      if (typeof parsed === 'string' && parsed.trim()) {
        return parsed.trim();
      }
      if (typeof parsed === 'object' && parsed !== null) {
        const name = parsed.username || parsed.user || parsed.User || parsed.Fullname || parsed.fullName || parsed.name || parsed.studentCode;
        if (name && String(name).trim()) return String(name).trim();
      }
    } catch (e) {
      // Nếu là chuỗi thuần (ví dụ: "admin" hoặc "thanh")
      if (typeof rawVal === 'string' && rawVal.trim() && rawVal !== 'null' && rawVal !== 'undefined' && rawVal !== '{}') {
        return rawVal.replace(/"/g, '').trim();
      }
    }
  }

  return '';
}

// Biến toàn cục lưu danh sách đề thi gốc để phục vụ lọc dữ liệu
window.rawFetchedExams = [];

/**
 * TẢI VÀ HIỂN THỊ DANH SÁCH ĐỀ THI (Hỗ trợ Admin Filter & Action Buttons)
 */
async function handleLoadMyExams() {
  console.log('🚀 [DEBUG] Bắt đầu gọi handleLoadMyExams()');

  const container = document.getElementById('myExamsListTable') || document.getElementById('myExamsList');
  const btnReload = document.getElementById('loadMyExamsBtn');
  const filterWrapper = document.getElementById('adminAuthorFilterWrapper');
  const filterSelect = document.getElementById('filterAuthorSelect');

  if (btnReload) {
    btnReload.disabled = true;
    btnReload.innerText = '⏳ Đang tải...';
  }

  if (!container) {
    console.error('❌ Không tìm thấy thẻ container hiển thị danh sách đề!');
    if (btnReload) {
      btnReload.disabled = false;
      btnReload.innerText = '🔄 Tải lại';
    }
    return;
  }

  container.innerHTML = '<p style="color: #2563eb; font-size: 13px; padding: 10px 0;">🔄 Đang kết nối máy chủ lấy danh sách đề thi...</p>';

  try {
    // 1. Quét tìm username từ tất cả Storage
    const username = getLoggedInUsername();
    console.log('🔍 Username phát hiện được từ Storage:', username);

    if (!username) {
      container.innerHTML = '<p style="color: #ef4444; font-size: 13px;">⚠️ Chưa tìm thấy phiên đăng nhập. Vui lòng đăng nhập lại tài khoản!</p>';
      return;
    }

    console.log(`📡 Đang gọi API lấy danh sách đề thi cho User: [${username}]`);

    // 2. Gọi Backend Apps Script
    const response = await appsScriptService.getLecturerExams(username);
    console.log('📦 Dữ liệu nhận từ Apps Script:', response);

    const exams = Array.isArray(response.exams) 
      ? response.exams 
      : (Array.isArray(response.data) ? response.data : []);

    // Lưu vào biến toàn cục để dùng cho bộ lọc Admin
    window.rawFetchedExams = exams;

    // 3. Xử lý Bộ Lọc Người Tạo cho Admin
    const isAdmin = String(username).trim().toLowerCase() === 'admin';
    if (isAdmin && filterWrapper && filterSelect) {
      filterWrapper.style.display = 'flex';

      // Trích xuất danh sách người tạo duy nhất
      const authors = [...new Set(exams.map(e => e.createdBy || 'N/A'))];
      let optionsHtml = '<option value="ALL">-- Tất cả người tạo --</option>';
      authors.forEach(author => {
        optionsHtml += `<option value="${escapeHtml(author)}">${escapeHtml(author)}</option>`;
      });
      filterSelect.innerHTML = optionsHtml;
    } else if (filterWrapper) {
      filterWrapper.style.display = 'none';
    }

    // 4. Render danh sách đề thi
    renderExamsList(exams, username);

  } catch (err) {
    console.error('❌ Lỗi tải danh sách đề:', err);
    container.innerHTML = `<p style="color: #ef4444; font-size: 13px; padding: 10px 0;">❌ Lỗi kết nối: ${err.message}</p>`;
  } finally {
    if (btnReload) {
      btnReload.disabled = false;
      btnReload.innerText = '🔄 Tải lại';
    }
  }
}

/**
 * HÀM RENDER DANH SÁCH ĐỀ THI RA THẺ CARD KÈM NÚT SỬA / XÓA / GIAO ĐỀ
 */
function renderExamsList(exams, currentUsername = '') {
  const container = document.getElementById('myExamsListTable') || document.getElementById('myExamsList');
  if (!container) return;

  if (!exams || exams.length === 0) {
    container.innerHTML = `<p style="color: #64748b; font-size: 13px; padding: 10px 0;">Chưa có đề thi nào phù hợp.</p>`;
    return;
  }

  let html = '<div style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px;">';
  
  exams.forEach((ex) => {
    const examId = escapeHtml(ex.examId || '');
    const examCode = escapeHtml(ex.examCode || ex.examId || 'N/A');
    const title = escapeHtml(ex.title || 'Đề thi trắc nghiệm');
    const duration = ex.durationMinutes || 45;
    const createdBy = escapeHtml(ex.createdBy || currentUsername || 'N/A');
    const createdAt = escapeHtml(ex.createdAt || 'N/A');

    html += `
      <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05); flex-wrap: wrap; gap: 10px;">
        <!-- THÔNG TIN ĐỀ THI -->
        <div>
          <strong style="font-size: 15px; color: #0f172a;">${title}</strong>
          <div style="font-size: 12px; color: #64748b; margin-top: 4px;">
            Mã đề: <code style="background:#f1f5f9; padding:2px 6px; border-radius:4px; color:#2563eb; font-weight:600;">${examCode}</code> 
            | Thời gian: <strong>${duration} phút</strong> 
            | Người tạo: <strong style="color: #d97706;">${createdBy}</strong>
            | Ngày tạo: ${createdAt}
          </div>
        </div>

        <!-- CÁC NÚT THAO TÁC: GIAO ĐỀ / SỬA / XÓA -->
        <div style="display: flex; align-items: center; gap: 6px;">
          <button type="button" onclick="handleOpenAssignModal('${examId}', '${title}')" title="Giao đề cho Lớp / Sinh viên" style="background: #059669; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 4px;">
            📤 Giao đề
          </button>
          <button type="button" onclick="handleEditExam('${ex.examId}', '${ex.examCode || ''}')" title="Chỉnh sửa nội dung đề" style="background: #d97706; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">
            ✏️ Sửa
          </button>
          <button type="button" onclick="handleDeleteExam('${examId}')" title="Xóa đề thi này" style="background: #dc2626; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 4px;">
            🗑️ Xóa
          </button>
        </div>
      </div>
    `;
  });

  html += '</div>';
  container.innerHTML = html;
}

// Gán hàm ra window
window.handleLoadMyExams = handleLoadMyExams;
window.renderExamsList = renderExamsList;

// -------------------------------------------------------------
// SỰ KIỆN TOÀN CỤC (EVENT LISTENERS)
// -------------------------------------------------------------

// 1. Lắng nghe click nút #loadMyExamsBtn
document.addEventListener('click', (e) => {
  const btn = e.target.closest('#loadMyExamsBtn');
  if (btn) {
    e.preventDefault();
    console.log('👉 Click nút #loadMyExamsBtn!');
    handleLoadMyExams();
  }
});

// 2. Lắng nghe thay đổi Lọc theo Người tạo (Admin Author Filter)
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'filterAuthorSelect') {
    const selectedAuthor = e.target.value;
    console.log(`🔍 Đang lọc đề thi theo tác giả: [${selectedAuthor}]`);

    if (selectedAuthor === 'ALL') {
      renderExamsList(window.rawFetchedExams);
    } else {
      const filtered = window.rawFetchedExams.filter(ex => 
        String(ex.createdBy || '').toLowerCase() === selectedAuthor.toLowerCase()
      );
      renderExamsList(filtered);
    }
  }
});

// -------------------------------------------------------------
// HÀM PHỤ TRỢ THAO TÁC NÚT BẤM (XÓA / SỬA / GIAO ĐỀ)
// -------------------------------------------------------------

window.handleDeleteExam = async function(examId) {
  if (!confirm(`Bạn có chắc chắn muốn XÓA vĩnh viễn đề thi [${examId}]?`)) return;
  
  try {
    const username = getLoggedInUsername();
    const res = await appsScriptService.deleteExam(examId, username);
    alert(res.message || 'Đã xóa đề thi thành công!');
    handleLoadMyExams(); // Tải lại danh sách sau khi xóa
  } catch (err) {
    alert('Lỗi khi xóa đề thi: ' + err.message);
  }
};

// Lưu trữ thông tin đề thi đang chỉnh sửa vào bộ nhớ tạm
window.currentEditingExamContext = null;

/**
 * 1. TẢI ĐÚNG CÂU HỎI VÀ ĐÁP ÁN ĐANG TỒN TẠI TỪ FILE JSON
 */
window.handleEditExam = async function(examId, examCode = '') {
  console.log('✏️ Bắt đầu nạp đề thi hiện tại. ID:', examId, 'Code:', examCode);

  const btn = event?.target?.closest('button');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ Đang nạp đề hiện tại...';
  }

  try {
    const config = (typeof APP_CONFIG !== 'undefined') ? APP_CONFIG : (window.APP_CONFIG || {
      GITHUB: { OWNER: 'thanhhuynh8989-stack', REPO: 'Kiem_tra', BRANCH: 'main' }
    });

    // Xác định tên file chuẩn (Ví dụ: exam_75ceb91a.json)
    let rawName = String(examCode || examId).trim();
    if (rawName.includes('-')) {
      rawName = rawName.split('-')[0];
    }
    if (!rawName.endsWith('.json')) {
      rawName = `${rawName}.json`;
    }

    const filePath = `exams/${rawName}`;
    const cdnUrl = `https://raw.githubusercontent.com/${config.GITHUB.OWNER}/${config.GITHUB.REPO}/${config.GITHUB.BRANCH}/${filePath}?t=${Date.now()}`;
    
    console.log('📡 Đang nạp tệp JSON thực tế từ GitHub CDN:', cdnUrl);

    let examData = null;

    // Tải nội dung tệp JSON lưu gần nhất từ CDN
    try {
      const res = await fetch(cdnUrl);
      if (res.ok) {
        examData = await res.json();
      }
    } catch (e) {
      console.warn('⚠️ GitHub CDN chưa phản hồi, thử tải từ Backend...');
    }

    // Dự phòng gọi Backend nếu CDN báo 404
    if (!examData && typeof appsScriptService !== 'undefined') {
      const backendRes = await appsScriptService.request('GET_EXAM_DETAIL', { examId, examCode, filePath });
      if (backendRes.status === 'success' && backendRes.examData) {
        examData = backendRes.examData;
      }
    }

    if (!examData) {
      throw new Error(`Không tìm thấy dữ liệu tệp [${filePath}]. Hãy chắc chắn đề thi đã được Xuất bản!`);
    }

    // Lấy chính xác danh sách câu hỏi trong JSON hiện tại
    const currentQuestions = Array.isArray(examData) 
      ? examData 
      : (examData.questions || examData.data?.questions || []);

    if (!Array.isArray(currentQuestions) || currentQuestions.length === 0) {
      throw new Error('Tệp JSON đề thi không có câu hỏi hợp lệ.');
    }

    console.log(`✅ Nạp thành công ${currentQuestions.length} câu hỏi hiện có từ tệp ${filePath}`);

    // Ghi nhớ Context của đề thi đang sửa để chuẩn bị cho việc GHI ĐÈ
    window.currentEditingExamContext = {
      examId: examId,
      examCode: rawName,
      filePath: filePath,
      title: examData.title || 'Đề thi trắc nghiệm',
      durationMinutes: examData.durationMinutes || 45
    };

    if (window.examModel) {
      window.examModel.setQuestions(currentQuestions);
    }

    // Nạp câu hỏi và đáp án thực tế lên màn hình chỉnh sửa
    if (typeof renderFullQuestionEditor === 'function') {
      renderFullQuestionEditor(currentQuestions, rawName);
    }

    // Cuộn trang mượt đến vị trí Trình chỉnh sửa
    const targetElement = document.getElementById('reviewQuestionsContainer') || document.getElementById('myExamsListTable');
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

  } catch (err) {
    console.error('❌ Lỗi nạp đề thi:', err);
    alert(`Không thể nạp đề thi hiện tại: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '✏️ Sửa';
    }
  }
};

/**
 * 2. LƯU THAY ĐỔI VÀ GHI ĐÈ NỘI DUNG LÊN TỆP JSON CŨ
 */
window.handleSaveEditedExam = async function() {
  const context = window.currentEditingExamContext;
  if (!context || !context.examId) {
    alert('⚠️ Chưa xác định được đề thi đang chỉnh sửa!');
    return;
  }

  const saveBtns = document.querySelectorAll('button[onclick*="handleSaveEditedExam"]');
  saveBtns.forEach(btn => {
    btn.disabled = true;
    btn.innerText = '⏳ Đang ghi đè dữ liệu...';
  });

  try {
    const cards = document.querySelectorAll('.question-editor-card');
    if (!cards || cards.length === 0) {
      throw new Error('Không có dữ liệu câu hỏi trên màn hình.');
    }

    // Thu thập dữ liệu đã sửa đổi từ giao diện
    const updatedQuestions = Array.from(cards).map((card, idx) => {
      const stemInput = card.querySelector('.q-stem-input');
      const stemText = stemInput ? stemInput.value.trim() : '';

      const checkedRadio = card.querySelector('.q-radio-ans:checked');
      const answerKey = checkedRadio ? checkedRadio.value : 'A';

      const optionInputs = card.querySelectorAll('.q-option-input');
      const options = Array.from(optionInputs).map(optEl => optEl.value.trim());

      while (options.length < 4) {
        options.push('');
      }

      return {
        id: idx + 1,
        stem: stemText,
        options: options.slice(0, 4),
        answerKey: answerKey
      };
    });

    const username = typeof getLoggedInUsername === 'function' ? getLoggedInUsername() : 'admin';

    console.log(`💾 Tiến hành GHI ĐÈ ${updatedQuestions.length} câu hỏi lên file [${context.filePath}]...`);

    // Gọi API lưu và GHI ĐÈ lên chính examId và filePath cũ
    const res = await appsScriptService.saveAndPublishExam(
      context.examId,
      'MASTER_KEY',
      { 
        title: context.title,
        durationMinutes: context.durationMinutes,
        questions: updatedQuestions 
      },
      context.filePath, // Giữ nguyên đường dẫn tệp JSON cũ
      username
    );

    alert(res.message || `✅ Đã ghi đè và cập nhật thành công tệp [${context.filePath}]!`);

    if (window.examModel) {
      window.examModel.setQuestions(updatedQuestions);
    }

    // Tải lại danh sách đề thi
    if (typeof handleLoadMyExams === 'function') {
      handleLoadMyExams();
    }

  } catch (err) {
    console.error('❌ Lỗi ghi đè đề thi:', err);
    alert(`Lỗi ghi đè đề thi: ${err.message}`);
  } finally {
    saveBtns.forEach(btn => {
      btn.disabled = false;
      btn.innerText = '💾 Lưu thay đổi đề thi';
    });
  }
};

/**
 * 2. TRÌNH DỰNG GIAO DIỆN CHỈNH SỬA CÂU HỎI ĐẦY ĐỦ (TỐI ƯU DOM & PERFORMANCE)
 */
function renderFullQuestionEditor(questions, fileName) {
  const reviewContainer = document.getElementById('reviewQuestionsContainer') || document.getElementById('myExamsListTable');
  if (!reviewContainer) return;

  if (!Array.isArray(questions) || questions.length === 0) {
    reviewContainer.innerHTML = '<p style="color: #ef4444; font-size: 13px; padding: 12px;">⚠️ Không có dữ liệu câu hỏi để hiển thị.</p>';
    return;
  }

  const escapeFn = typeof escapeHtml === 'function' ? escapeHtml : safeEscapeHtml;

  // 1. Header công cụ
  const headerHtml = `
    <div style="background: #eff6ff; border: 1px solid #bfdbfe; padding: 14px 18px; border-radius: 8px; color: #1e40af; font-weight: 600; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
      <span>📝 Đang chỉnh sửa Đề thi: <strong style="color: #2563eb;">[${escapeFn(fileName)}]</strong> (${questions.length} câu hỏi)</span>
      <button type="button" onclick="handleSaveEditedExam()" style="background: #2563eb; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">
        💾 Lưu thay đổi đề thi
      </button>
    </div>
  `;

  // 2. Render danh sách thẻ câu hỏi bằng map().join('')
  const cardsHtml = questions.map((q, idx) => {
    const stemText = q.stem || q.text || q.value || '';
    const optionsList = Array.isArray(q.options) ? q.options : (Array.isArray(q.choices) ? q.choices : []);
    const answerKey = String(q.answerKey || q.answer || q.key || '').trim().toUpperCase();

    // Chuẩn hóa 4 đáp án A, B, C, D
    const formattedOptions = ['', '', '', ''];
    optionsList.forEach((opt, oIdx) => {
      if (oIdx < 4) {
        let optStr = typeof opt === 'string' ? opt : (opt.text || opt.content || String(opt || ''));
        formattedOptions[oIdx] = optStr.replace(/^[A-D][.:)]\s*/i, '').trim();
      }
    });

    const isAnswerMissing = !['A', 'B', 'C', 'D'].includes(answerKey);

    const optionsHtml = formattedOptions.map((optVal, oIdx) => {
      const letter = String.fromCharCode(65 + oIdx);
      const isChecked = (answerKey === letter) || (isAnswerMissing && letter === 'A');

      return `
        <div style="display: flex; align-items: center; gap: 10px;">
          <label style="display: flex; align-items: center; gap: 6px; font-weight: 700; color: #334155; min-width: 40px; cursor: pointer;">
            <input type="radio" name="correct_ans_${idx}" class="q-radio-ans" value="${letter}" ${isChecked ? 'checked' : ''} style="width: 16px; height: 16px; cursor: pointer;">
            ${letter}.
          </label>
          <input type="text" class="q-option-input" value="${escapeFn(optVal)}" placeholder="Lựa chọn ${letter}..." style="flex: 1; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; background: #ffffff;">
        </div>
      `;
    }).join('');

    return `
      <div class="question-editor-card" data-idx="${idx}" style="background: #ffffff; border: ${isAnswerMissing ? '2px solid #f97316' : '1px solid #cbd5e1'}; border-radius: 10px; padding: 16px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <strong style="font-size: 15px; color: #0f172a;">Câu ${idx + 1}:</strong>
          <span class="badge-ans-status" style="${isAnswerMissing ? 'background: #ffedd5; color: #c2410c; border: 1px solid #fed7aa;' : 'background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0;'} padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600;">
            ${isAnswerMissing ? '⚠️ Chưa chọn đáp án gốc (Tạm chọn A)' : `✅ Đáp án đúng: ${answerKey}`}
          </span>
        </div>

        <textarea class="q-stem-input" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box; font-family: inherit; font-size: 14px; margin-bottom: 12px; min-height: 60px; line-height: 1.4;">${escapeFn(stemText)}</textarea>

        <div style="display: flex; flex-direction: column; gap: 8px; background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #f1f5f9;">
          <span style="font-size: 12px; font-weight: 600; color: #64748b; margin-bottom: 4px;">Các lựa chọn đáp án (Tích chọn nút tròn để xác định đáp án đúng):</span>
          ${optionsHtml}
        </div>
      </div>
    `;
  }).join('');

  // 3. Footer Lưu
  const footerHtml = `
    <div style="text-align: right; margin-top: 16px; margin-bottom: 30px;">
      <button type="button" onclick="handleSaveEditedExam()" style="background: #2563eb; color: white; border: none; padding: 10px 24px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; box-shadow: 0 2px 4px rgba(37,99,235,0.2);">
        💾 Lưu thay đổi đề thi
      </button>
    </div>
  `;

  reviewContainer.innerHTML = headerHtml + cardsHtml + footerHtml;
}

window.renderFullQuestionEditor = renderFullQuestionEditor;

/**
 * CẬP NHẬT BADGE ĐÁP ÁN THỜI GIAN THỰC KHI THAY ĐỔI RADIO
 */
document.addEventListener('change', (e) => {
  if (e.target && e.target.classList.contains('q-radio-ans')) {
    const card = e.target.closest('.question-editor-card');
    if (!card) return;

    const badge = card.querySelector('.badge-ans-status');
    const selectedLetter = e.target.value;

    if (badge) {
      badge.style.background = '#dcfce7';
      badge.style.color = '#15803d';
      badge.style.border = '1px solid #bbf7d0';
      badge.innerHTML = `✅ Đáp án đúng: ${selectedLetter}`;
    }
    card.style.border = '1px solid #cbd5e1';
  }
});

/**
 * TỐI ƯU HÀM LƯU THAY ĐỔI ĐỀ THI (DUYỆT THEO CLASS SELECTOR)
 */
window.handleSaveEditedExam = async function() {
  const context = window.currentEditingExamContext;
  if (!context || !context.examId) {
    alert('⚠️ Chưa xác định được đề thi đang chỉnh sửa!');
    return;
  }

  const saveBtns = document.querySelectorAll('button[onclick*="handleSaveEditedExam"]');
  saveBtns.forEach(btn => {
    btn.disabled = true;
    btn.innerText = '⏳ Đang ghi đè dữ liệu...';
  });

  try {
    const cards = document.querySelectorAll('.question-editor-card');
    if (!cards || cards.length === 0) {
      throw new Error('Không có dữ liệu câu hỏi trên màn hình.');
    }

    // Thu thập dữ liệu đã sửa đổi từ giao diện
    const updatedQuestions = Array.from(cards).map((card, idx) => {
      const stemInput = card.querySelector('.q-stem-input');
      const stemText = stemInput ? stemInput.value.trim() : '';

      const checkedRadio = card.querySelector('.q-radio-ans:checked');
      const answerKey = checkedRadio ? checkedRadio.value : 'A';

      const optionInputs = card.querySelectorAll('.q-option-input');
      const options = Array.from(optionInputs).map(optEl => optEl.value.trim());

      while (options.length < 4) {
        options.push('');
      }

      return {
        id: idx + 1,
        stem: stemText,
        options: options.slice(0, 4),
        answerKey: answerKey
      };
    });

    const username = typeof getLoggedInUsername === 'function' ? getLoggedInUsername() : 'admin';

    console.log(`💾 Tiến hành GHI ĐÈ ${updatedQuestions.length} câu hỏi lên file [${context.filePath}]...`);

    // Gọi API lưu và GHI ĐÈ lên chính examId và filePath cũ
    const res = await appsScriptService.saveAndPublishExam(
      context.examId,
      'MASTER_KEY',
      { 
        title: context.title,
        durationMinutes: context.durationMinutes,
        questions: updatedQuestions 
      },
      context.filePath, // Giữ nguyên đường dẫn tệp JSON cũ
      username
    );

    alert(res.message || `✅ Đã ghi đè và cập nhật thành công tệp [${context.filePath}]!`);

    if (window.examModel) {
      window.examModel.setQuestions(updatedQuestions);
    }

    // Tải lại danh sách đề thi
    if (typeof handleLoadMyExams === 'function') {
      handleLoadMyExams();
    }

  } catch (err) {
    console.error('❌ Lỗi ghi đè đề thi:', err);
    alert(`Lỗi ghi đè đề thi: ${err.message}`);
  } finally {
    saveBtns.forEach(btn => {
      btn.disabled = false;
      btn.innerText = '💾 Lưu thay đổi đề thi';
    });
  }
};
/**
 * 2. QUẢN LÝ SINH VIÊN VÀ BẢNG ĐIỂM THI
 */
async function handleLoadStudentsAndGrades() {
  console.log('🚀 [DEBUG] Kích hoạt handleLoadStudentsAndGrades()');

  const container = document.getElementById('studentsAndGradesTable');
  const btn = event?.target?.closest('button');

  if (btn) {
    btn.disabled = true;
    btn.innerText = '⏳ Đang nạp bảng điểm...';
  }

  if (!container) {
    console.error('❌ Không tìm thấy khung #studentsAndGradesTable!');
    if (btn) { btn.disabled = false; btn.innerText = '📊 Tải Bảng Điểm & Sinh Viên'; }
    return;
  }

  container.innerHTML = '<p style="color: #2563eb; font-size: 13px; padding: 12px 0;">🔄 Đang lấy danh sách Sinh viên và Bảng điểm từ máy chủ...</p>';

  try {
    // Gọi song song danh sách Sinh viên và Lịch sử làm bài
    const [stRes, subRes] = await Promise.all([
      appsScriptService.getStudents(),
      appsScriptService.getSubmissions()
    ]);

    const students = Array.isArray(stRes.students) ? stRes.students : (Array.isArray(stRes.data) ? stRes.data : []);
    const submissions = Array.isArray(subRes.submissions) ? subRes.submissions : (Array.isArray(subRes.data) ? subRes.data : []);

    if (students.length === 0 && submissions.length === 0) {
      container.innerHTML = '<p style="color: #64748b; font-size: 13px; padding: 12px 0;">Chưa có dữ liệu sinh viên hoặc bài nộp nào trong hệ thống.</p>';
      return;
    }

    let html = `
      <div style="overflow-x: auto; margin-top: 10px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; background: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0;">
          <thead>
            <tr style="background: #f8fafc; border-bottom: 2px solid #cbd5e1; color: #1e293b;">
              <th style="padding: 12px;">Mã Sinh Viên</th>
              <th style="padding: 12px;">Họ và Tên</th>
              <th style="padding: 12px;">Lớp</th>
              <th style="padding: 12px;">Đề thi đã làm</th>
              <th style="padding: 12px;">Điểm số</th>
              <th style="padding: 12px;">Thời gian nộp</th>
            </tr>
          </thead>
          <tbody>
    `;

    if (students.length > 0) {
      students.forEach(st => {
        const studentSubs = submissions.filter(sub => String(sub.studentCode || '').toLowerCase() === String(st.studentCode || '').toLowerCase());

        if (studentSubs.length > 0) {
          studentSubs.forEach(sub => {
            html += `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px 12px; font-weight: 600; color: #0f172a;">${escapeHtml(st.studentCode)}</td>
                <td style="padding: 10px 12px;">${escapeHtml(st.fullName)}</td>
                <td style="padding: 10px 12px;"><span style="background: #f1f5f9; padding: 2px 8px; border-radius: 4px; font-weight: 500;">${escapeHtml(st.className)}</span></td>
                <td style="padding: 10px 12px; color: #2563eb; font-weight: 500;">${escapeHtml(sub.examId)}</td>
                <td style="padding: 10px 12px; font-weight: 700; color: #059669;">${sub.score} / 10</td>
                <td style="padding: 10px 12px; color: #64748b;">${escapeHtml(sub.submittedAt)}</td>
              </tr>
            `;
          });
        } else {
          html += `
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 10px 12px; font-weight: 600; color: #0f172a;">${escapeHtml(st.studentCode)}</td>
              <td style="padding: 10px 12px;">${escapeHtml(st.fullName)}</td>
              <td style="padding: 10px 12px;"><span style="background: #f1f5f9; padding: 2px 8px; border-radius: 4px; font-weight: 500;">${escapeHtml(st.className)}</span></td>
              <td style="padding: 10px 12px; color: #94a3b8; font-style: italic;">Chưa nộp bài nào</td>
              <td style="padding: 10px 12px; color: #94a3b8;">-</td>
              <td style="padding: 10px 12px; color: #94a3b8;">-</td>
            </tr>
          `;
        }
      });
    } else {
      // Hiển thị trực tiếp nếu chưa có danh sách sinh viên nhưng có kết quả thi
      submissions.forEach(sub => {
        html += `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 12px; font-weight: 600; color: #0f172a;">${escapeHtml(sub.studentCode)}</td>
            <td style="padding: 10px 12px;">${escapeHtml(sub.studentName || sub.studentCode)}</td>
            <td style="padding: 10px 12px;">-</td>
            <td style="padding: 10px 12px; color: #2563eb; font-weight: 500;">${escapeHtml(sub.examId)}</td>
            <td style="padding: 10px 12px; font-weight: 700; color: #059669;">${sub.score} / 10</td>
            <td style="padding: 10px 12px; color: #64748b;">${escapeHtml(sub.submittedAt)}</td>
          </tr>
        `;
      });
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;

  } catch (err) {
    console.error('❌ Lỗi nạp dữ liệu sinh viên:', err);
    container.innerHTML = `<p style="color: #ef4444; font-size: 13px; padding: 12px 0;">❌ Không thể kết nối dữ liệu: ${err.message}</p>`;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = '📊 Tải Bảng Điểm & Sinh Viên';
    }
  }
}

// 3. XUẤT HÀM RA WINDOW TOÀN CỤC ĐỂ HTML NÚT BẤM GỌI ĐƯỢC TRỰC TIẾP
window.handleLoadStudentsAndGrades = handleLoadStudentsAndGrades;

window.handleOpenAssignModal = function(examId, title) {
  const modal = document.getElementById('assignExamModal');
  const idInput = document.getElementById('assignExamId');
  const titleEl = document.getElementById('assignExamTitle');

  if (idInput) idInput.value = examId;
  if (titleEl) titleEl.innerText = `Đề thi: ${title} (${examId})`;
  if (modal) modal.style.display = 'flex';
};

window.closeAssignModal = function() {
  const modal = document.getElementById('assignExamModal');
  if (modal) modal.style.display = 'none';
};

// Hàm escape HTML an toàn cho chuỗi
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Tự động tải dữ liệu khi khung chứa vừa xuất hiện trên màn hình
setInterval(() => {
  const container = document.getElementById('myExamsListTable') || document.getElementById('myExamsList');
  if (container && container.children.length === 0 && container.innerHTML.trim() === '') {
    handleLoadMyExams();
  }
}, 1500);

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

// Biến lưu trữ trạng thái danh sách sinh viên hiện tại
window.currentStudentsList = [];

/**
 * 1. DỰNG GIAO DIỆN QUẢN LÝ SINH VIÊN & GÁN ĐỀ THI
 */
window.renderStudentManagementUI = function(students = []) {
  window.currentStudentsList = students;
  const container = document.getElementById('studentManagementContainer') || document.getElementById('myExamsListTable');
  if (!container) return;

  container.innerHTML = `
    <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.02); margin-top: 20px;">
      
      <!-- TOOLBAR QUẢN LÝ -->
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px;">
        <h3 style="margin: 0; font-size: 18px; color: #0f172a; display: flex; align-items: center; gap: 8px;">
          🎓 Quản Lý Sinh Viên (${students.length})
        </h3>
        
        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <!-- Nút Upload Excel -->
          <label style="background: #16a34a; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
            📁 Nhập Danh Sách (Excel)
            <input type="file" id="excelStudentInput" accept=".xlsx, .xls, .csv" onchange="handleUploadStudentExcel(event)" style="display: none;">
          </label>

          <!-- Nút Thêm 1 sinh viên -->
          <button type="button" onclick="handlePromptAddStudent()" style="background: #2563eb; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600;">
            ➕ Thêm Sinh Viên
          </button>

          <!-- Nút Gán Đề Thi -->
          <button type="button" onclick="handleOpenAssignExamModal()" style="background: #d97706; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600;">
            📌 Gán Đề Thi
          </button>
        </div>
      </div>

      <!-- BẢNG DANH SÁCH SINH VIÊN -->
      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; text-align: left;">
          <thead>
            <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; color: #475569;">
              <th style="padding: 10px; width: 40px; text-align: center;">
                <input type="checkbox" id="selectAllStudents" onchange="toggleSelectAllStudents(this)" style="cursor: pointer;">
              </th>
              <th style="padding: 10px;">Mã SV (Username)</th>
              <th style="padding: 10px;">Họ và Tên</th>
              <th style="padding: 10px;">Mật khẩu</th>
              <th style="padding: 10px; text-align: right;">Hành động</th>
            </tr>
          </thead>
          <tbody>
            ${students.length === 0 ? `
              <tr>
                <td colspan="5" style="text-align: center; padding: 24px; color: #94a3b8;">
                  Chưa có sinh viên nào. Vui lòng bấm "Nhập Danh Sách (Excel)" hoặc "Thêm Sinh Viên".
                </td>
              </tr>
            ` : students.map((st, idx) => `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px; text-align: center;">
                  <input type="checkbox" class="student-select-cb" value="${st.username}" style="cursor: pointer;">
                </td>
                <td style="padding: 10px; font-weight: 600; color: #1e293b;">${st.username}</td>
                <td style="padding: 10px; color: #334155;">${st.fullName || st.username}</td>
                <td style="padding: 10px; color: #64748b; font-family: monospace;">${st.password || '******'}</td>
                <td style="padding: 10px; text-align: right;">
                  <button type="button" onclick="handleDeleteStudentUI('${st.username}')" style="background: #ef4444; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 12px;">
                    🗑️ Xóa
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

    </div>
  `;
};

/**
 * 2. TẢI FILE EXCEL VÀ IMPORT DANH SÁCH SINH VIÊN
 */
window.handleUploadStudentExcel = function(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (typeof XLSX === 'undefined') {
    alert('⚠️ Chưa nạp thư viện đọc file Excel (SheetJS). Vui lòng thêm thẻ script XLSX vào index.html!');
    return;
  }

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // Chuyển dữ liệu Sheet thành mảng JSON
      const jsonRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      if (jsonRows.length < 2) {
        alert(' File Excel rỗng hoặc không có cột dữ liệu!');
        return;
      }

      const parsedStudents = [];
      // Đọc từ dòng thứ 2 (bỏ qua Header)
      for (let i = 1; i < jsonRows.length; i++) {
        const row = jsonRows[i];
        if (!row || row.length === 0) continue;

        const username = String(row[0] || '').trim(); // Cột A: Mã SV / Username
        const fullName = String(row[1] || username).trim(); // Cột B: Họ Tên
        const password = String(row[2] || '123456').trim(); // Cột C: Mật khẩu

        if (username) {
          parsedStudents.push({ username, fullName, password });
        }
      }

      if (parsedStudents.length === 0) {
        alert(' Không tìm thấy dòng dữ liệu sinh viên hợp lệ trong file!');
        return;
      }

      console.log(`📥 Đã đọc được ${parsedStudents.length} sinh viên từ Excel. Đang gửi lên máy chủ...`);

      // Gửi danh sách lên Google Apps Script
      const res = await appsScriptService.request('SAVE_STUDENT_LIST', { students: parsedStudents });
      alert(res.message || '✅ Đã tải lên danh sách sinh viên thành công!');

      // Làm mới lại bảng sinh viên
      if (typeof handleLoadStudents === 'function') {
        handleLoadStudents();
      }

    } catch (err) {
      console.error('Lỗi đọc file Excel:', err);
      alert(`Lỗi đọc file Excel: ${err.message}`);
    } finally {
      event.target.value = ''; // Reset input file
    }
  };

  reader.readAsArrayBuffer(file);
};

/**
 * 3. THÊM 1 SINH VIÊN THỦ CÔNG
 */
window.handlePromptAddStudent = async function() {
  const username = prompt('Nhập Mã Sinh Viên (Username):');
  if (!username) return;

  const fullName = prompt('Nhập Họ và Tên Sinh Viên:', username) || username;
  const password = prompt('Nhập Mật khẩu tài khoản:', '123456') || '123456';

  try {
    const res = await appsScriptService.request('SAVE_STUDENT_LIST', {
      students: [{ username: username.trim(), fullName: fullName.trim(), password: password.trim() }]
    });
    alert(res.message || '✅ Đã thêm sinh viên mới!');
    
    if (typeof handleLoadStudents === 'function') {
      handleLoadStudents();
    }
  } catch (err) {
    alert(`Lỗi thêm sinh viên: ${err.message}`);
  }
};

/**
 * 4. XÓA SINH VIÊN
 */
window.handleDeleteStudentUI = async function(username) {
  if (!confirm(`Bạn có chắc chắn muốn xóa sinh viên [${username}]?`)) return;

  try {
    const res = await appsScriptService.request('DELETE_STUDENT', { username });
    alert(res.message || '✅ Đã xóa sinh viên!');

    if (typeof handleLoadStudents === 'function') {
      handleLoadStudents();
    }
  } catch (err) {
    alert(`Lỗi khi xóa sinh viên: ${err.message}`);
  }
};

/**
 * 5. MỞ DIALOG GÁN ĐỀ THI CHO SINH VIÊN DƯỢC CHỌN HOẶC TOÀN BỘ
 */
window.handleOpenAssignExamModal = async function() {
  // Lấy các sinh viên được chọn từ Checkbox
  const checkedBoxes = document.querySelectorAll('.student-select-cb:checked');
  let selectedUsers = Array.from(checkedBoxes).map(cb => cb.value);

  if (selectedUsers.length === 0) {
    if (confirm('Bạn chưa chọn sinh viên cụ thể nào. Bạn có muốn GÁN ĐỀ THI CHO TOÀN BỘ sinh viên trong danh sách không?')) {
      selectedUsers = window.currentStudentsList.map(s => s.username);
    } else {
      return;
    }
  }

  if (selectedUsers.length === 0) {
    alert('⚠️ Danh sách sinh viên rỗng, không thể thực hiện gán đề!');
    return;
  }

  const examId = prompt(`Gán đề thi cho ${selectedUsers.length} sinh viên.\nNhập Mã đề thi (Ví dụ: exam_75ceb91a.json):`);
  if (!examId) return;

  try {
    const username = typeof getLoggedInUsername === 'function' ? getLoggedInUsername() : 'admin';
    
    // Gọi API Assign Exam
    const res = await appsScriptService.request('ASSIGN_EXAM', {
      examId: examId.trim(),
      targetStudents: selectedUsers,
      assignedBy: username
    });

    alert(res.message || `✅ Đã gán thành công đề thi [${examId}] cho ${selectedUsers.length} sinh viên!`);
  } catch (err) {
    alert(`Lỗi gán đề thi: ${err.message}`);
  }
};

/**
 * HELPER: CHỌN / BỎ CHỌN TẤT CẢ CHECKBOX SINH VIÊN
 */
window.toggleSelectAllStudents = function(masterCb) {
  const cbs = document.querySelectorAll('.student-select-cb');
  cbs.forEach(cb => cb.checked = masterCb.checked);
};

/**
 * TẢI VÀ HIỂN THỊ DANH SÁCH SINH VIÊN TỪ SERVER
 */
window.handleLoadStudents = async function() {
  const container = document.getElementById('studentManagementContainer');
  if (container) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: #2563eb; font-weight: 600;">
        ⏳ Đang tải danh sách sinh viên từ hệ thống...
      </div>
    `;
  }

  try {
    // Gọi API lấy danh sách Sinh viên từ Apps Script (Role = STUDENT)
    const res = await appsScriptService.request('GET_STUDENTS', {});
    
    const students = res.students || res.data || [];
    console.log(`✅ Đã tải ${students.length} sinh viên từ máy chủ.`, students);

    // Hiển thị giao diện bảng quản lý sinh viên
    renderStudentManagementUI(students);

  } catch (err) {
    console.error('❌ Lỗi tải danh sách sinh viên:', err);
    if (container) {
      container.innerHTML = `
        <div style="padding: 16px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #dc2626; font-size: 14px;">
          ❌ Lỗi nạp danh sách sinh viên: ${err.message}. Vui lòng thử lại!
        </div>
      `;
    }
  }
};

// Tự động gọi tải danh sách sinh viên khi trang web được nạp xong (nếu ở giao diện Giảng viên)
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (document.getElementById('studentManagementContainer')) {
      handleLoadStudents();
    }
  }, 500);
});
