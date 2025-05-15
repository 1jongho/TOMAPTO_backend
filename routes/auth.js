// auth.js
const jwt = require('jsonwebtoken');
const db = require('../db');

// 토큰 검증 미들웨어
exports.isValidToken = (req, res, next) => {
  try {
    // 헤더에서 토큰 추출
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: '인증 토큰이 필요합니다.' });
    }
    
    const token = authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: '유효한 토큰 형식이 아닙니다.' });
    }
    
    // 토큰 검증을 try-catch로 감싸 상세 오류 로깅
    try {
      // 토큰 검증
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      
      // 토큰에서 사용자 ID 추출
      const userId = decoded.user_id;
      
      if (!userId) {
        console.error('유효하지 않은 토큰 페이로드:', decoded);
        return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
      }
      
      console.log(`토큰 검증 성공 - 사용자 ID: ${userId}`);
      
      // 데이터베이스에서 사용자 검증
      const sql = 'SELECT user_id, user_status FROM users WHERE user_id = ?';
      
      db.query(sql, [userId], (err, results) => {
        if (err) {
          console.error('사용자 검증 중 데이터베이스 오류:', err);
          return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
        }
        
        if (results.length === 0) {
          console.error(`존재하지 않는 사용자 ID: ${userId}`);
          return res.status(401).json({ error: '존재하지 않는 사용자입니다.' });
        }
        
        if (results[0].user_status !== 'active') {
          console.error(`비활성화된 사용자 - ID: ${userId}, 상태: ${results[0].user_status}`);
          return res.status(401).json({ error: '비활성화된 사용자입니다.' });
        }
        
        // 요청 객체에 사용자 정보 추가
        req.user = { user_id: userId };
        console.log(`인증 성공 - 사용자 ID: ${userId}`);
        next();
      });
    } catch (jwtError) {
      console.error('JWT 검증 실패:', jwtError);
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({ error: '토큰이 만료되었습니다. 다시 로그인해주세요.' });
      }
      
      if (jwtError.name === 'JsonWebTokenError') {
        return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
      }
      
      return res.status(401).json({ error: '토큰 검증 실패: ' + jwtError.message });
    }
  } catch (error) {
    console.error('인증 미들웨어 오류:', error);
    
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
};

// 관리자 권한 검증 미들웨어
exports.isAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: '인증이 필요합니다.' });
  }
  
  const userId = req.user.user_id;
  
  const sql = 'SELECT user_role FROM users WHERE user_id = ?';
  
  db.query(sql, [userId], (err, results) => {
    if (err) {
      console.error('관리자 권한 검증 중 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    if (results.length === 0 || results[0].user_role !== 'admin') {
      return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
    }
    
    console.log(`관리자 권한 확인 - 사용자 ID: ${userId}`);
    next();
  });
};

// 간편 인증 미들웨어 별칭
exports.auth = exports.isValidToken;

// 모듈 전체 내보내기
module.exports = {
  isValidToken: exports.isValidToken,
  isAdmin: exports.isAdmin,
  auth: exports.isValidToken  // 기본 인증 미들웨어
};