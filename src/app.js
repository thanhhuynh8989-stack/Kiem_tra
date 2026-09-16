import { githubService } from './services/githubService.js';
import { appsScriptService } from './services/appsScriptService.js';
import { parseDocxFile } from './parsers/docxParser.js';
import { parsePdfFile } from './parsers/pdfParser.js';
import { renderKaTeX } from './utils/domHelper.js';
import { examModel } from './models/examModel.js';
import { logger } from './utils/logger.js';

let currentExamData = null;
const studentAnswers = {};

document.addEventListener('DOMContentLoaded', () => {
  // 1. Lắng nghe sự kiện Học sinh tải đề
  document.getElementById('loadExamBtn').addEventListener('click', handleLoadExam);
  
  // 2. Lắng nghe sự kiện Học sinh nộp bài
  document.getElementById('submitExamBtn').addEventListener('click', handleSubmitExam);

  // 3. Lắng nghe sự kiện Giảng viên tải file đề thi lên
  document.getElementById('processExamBtn').addEventListener('click', handleProcessFile);
});

/**
 * Xử lý tải đề thi cho Học sinh
 */
async function handleLoadExam() {
  const code = document.getElementById('examCodeInput').value.trim();
  if (!code) return alert('Vui lòng nhập mã đề thi!');

  try {
    const filename = code.endsWith('.json') ? code : `${code}.json`;
    currentExamData = await githubService.getExam(filename);

    document.getElementById('examTitle').textContent = currentExamData.title || 'Bài Thi Trực Tuyến';
    renderQuestions(currentExamData.questions);
    
    document.getElementById('examSearchSection').style.display = 'none';
    document.getElementById('examContainer').style.display = 'block';

    // Render KaTeX cho công thức toán
    renderKaTeX(document.getElementById('questionsList'));
  } catch (err) {
    logger.error('Lỗi tải đề thi:', err);
    alert('Không tìm thấy đề thi hoặc file không đúng cấu trúc!');
  }
}

/**
 * Hiển thị danh sách câu hỏi
 */
function renderQuestions(questions) {
  const container = document.getElementById('questionsList');
  container.innerHTML = '';

  questions.forEach((q, index) => {
    const card = document.createElement('div');
    card.className = 'question-card';

    let html = `<p><strong>Câu ${index + 1}:</strong> ${q.stem}</p>`;
    
    q.options.forEach(opt => {
      html += `
        <div class="option-item">
          <label style="font-weight: normal; cursor: pointer;">
            <input type="radio" name="q_${q.id}" value="${opt.key}" onchange="saveAnswer('${q.id}', '${opt.key}')">
            <strong>${opt.key}.</strong> ${opt.text}
          </label>
        </div>
      `;
    });

    card.innerHTML = html;
    container.appendChild(card);
  });
}

// Lưu lựa chọn học sinh
window.saveAnswer = (qId, optionKey) => {
  studentAnswers[qId] = optionKey;
};

/**
 * Xử lý nộp bài
 */
async function handleSubmitExam() {
  const name = document.getElementById('studentName').value.trim();
  const code = document.getElementById('studentCode').value.trim();

  if (!name || !code) return alert('Vui lòng điền đủ Họ tên và MSSV/Lớp!');

  try {
    const response = await appsScriptService.submitExamAnswers(
      currentExamData.id,
      { name, code },
      studentAnswers
    );

    document.getElementById('examContainer').style.display = 'none';
    document.getElementById('resultContainer').style.display = 'block';
    document.getElementById('scoreText').textContent = `Điểm số của bạn: ${response.data.finalGrade} / 10 (Đúng ${response.data.score}/${response.data.totalQuestions} câu)`;
  } catch (err) {
    logger.error('Lỗi nộp bài:', err);
    alert('Lỗi nộp bài thi. Vui lòng thử lại!');
  }
}

/**
 * Xử lý bóc tách & tải đề lên cho Giảng viên
 */
async function handleProcessFile() {
  const fileInput = document.getElementById('examFileInput');
  const statusDiv = document.getElementById('uploadStatus');

  if (!fileInput.files.length) return alert('Vui lòng chọn 1 file đề thi!');
  
  const file = fileInput.files[0];
  statusDiv.textContent = 'Đang xử lý file và chuyển đổi KaTeX...';

  try {
    let parsedQuestions = [];
    if (file.name.endsWith('.docx')) {
      parsedQuestions = await parseDocxFile(file);
    } else if (file.name.endsWith('.pdf')) {
      parsedQuestions = await parsePdfFile(file);
    } else {
      throw new Error('Định dạng file không hỗ trợ!');
    }

    statusDiv.textContent = 'Đang tách khóa đáp án và upload lên Server...';

    // Phân tách Đề Public & Master Key
    const { examId, publicData, masterKey } = examModel.splitExamAndKey({
      title: file.name.replace(/\.[^/.]+$/, ""),
      questions: parsedQuestions
    });

    const fileNameOnGithub = `exam_${examId.slice(0, 8)}.json`;

    // Gửi sang Apps Script xử lý đẩy GitHub và lưu Đáp Án Bảo Mật
    await appsScriptService.saveAndPublishExam(
      examId,
      masterKey,
      publicData,
      `exams/${fileNameOnGithub}`
    );

    statusDiv.innerHTML = `<span style="color: green;">Thành công! Mã đề thi của học sinh là: <strong>${fileNameOnGithub}</strong></span>`;
  } catch (err) {
    logger.error('Lỗi xử lý đề thi:', err);
    statusDiv.innerHTML = `<span style="color: red;">Lỗi: ${err.message}</span>`;
  }
}
