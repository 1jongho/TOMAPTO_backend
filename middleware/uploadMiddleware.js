const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

// 메모리 스토리지 사용 (임시로 메모리에 저장)
const storage = multer.memoryStorage();

// 파일 필터 (이미지만 허용) - 수정된 버전
const fileFilter = (req, file, cb) => {
  console.log('파일 필터 확인:', {
    fieldname: file.fieldname,
    originalname: file.originalname,
    mimetype: file.mimetype
  });
  
  // MIME 타입 확인 (더 유연하게)
  const allowedMimeTypes = [
    'image/jpeg',
    'image/jpg', 
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp'
  ];
  
  // 파일 확장자도 확인
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
  const fileExtension = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));
  
  if (allowedMimeTypes.includes(file.mimetype.toLowerCase()) || allowedExtensions.includes(fileExtension)) {
    console.log('이미지 파일 승인:', file.mimetype);
    cb(null, true);
  } else {
    console.log('지원하지 않는 파일 형식:', file.mimetype);
    cb(new Error(`지원하지 않는 파일 형식입니다. (${file.mimetype})`), false);
  }
};

// Multer 설정
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB로 증가
  }
});

// 파일명 생성 함수
const generateFileName = (originalname) => {
  const extension = originalname.split('.').pop();
  return `profile_${uuidv4()}.${extension}`;
};

module.exports = { upload, generateFileName };