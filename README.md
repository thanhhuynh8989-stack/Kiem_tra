src/
├── constants/
│   ├── appConfig.js        # Chứa cấu hình hệ thống, regex pattern, enum trạng thái
│   └── apiEndpoints.js     # Quản lý URL endpoint của GitHub / Apps Script
├── utils/
│   ├── logger.js           # Thư viện ghi log phân cấp (DEBUG, INFO, ERROR)
│   ├── domHelper.js        # Thao tác DOM, render KaTeX theo batch (DocumentFragment)
│   ├── imageCompressor.js  # Nén ảnh Base64 trước khi gửi đi
│   └── errorHandler.js     # Xử lý và bắt ngoại lệ tập trung
├── services/
│   ├── geminiService.js    # Gọi Gemini Vision (OCR, Exponential Backoff retry)
│   ├── githubService.js    # Tương tác GitHub REST API
│   └── appsScriptService.js# Tương tác Backend Google Apps Script
├── parsers/
│   ├── docxParser.js       # Bóc tách file DOCX (Mammoth.js)
│   └── pdfParser.js        # Bóc tách file PDF
└── models/
    └── examModel.js        # Chuyển đổi và chuẩn hóa cấu trúc đề thi / tách key
