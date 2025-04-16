// middlewares/auth.js
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
    
    // 토큰 검증
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    // 토큰에서 사용자 ID 추출
    const userId = decoded.user_id;
    
    if (!userId) {
      return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
    }
    
    // 데이터베이스에서 사용자 검증 (옵션)
    const sql = 'SELECT user_id FROM Users WHERE user_id = ? AND user_status = "active"';
    
    db.query(sql, [userId], (err, results) => {
      if (err) {
        console.error('사용자 검증 중 오류:', err);
        return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
      }
      
      if (results.length === 0) {
        return res.status(401).json({ error: '존재하지 않거나 비활성화된 사용자입니다.' });
      }
      
      // 요청 객체에 사용자 정보 추가
      req.user = { user_id: userId };
      next();
    });
  } catch (error) {
    console.error('토큰 검증 중 오류:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: '토큰이 만료되었습니다. 다시 로그인해주세요.' });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
    }
    
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
};

// 관리자 권한 검증 미들웨어 (필요한 경우 사용)
exports.isAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: '인증이 필요합니다.' });
  }
  
  const userId = req.user.user_id;
  
  const sql = 'SELECT user_role FROM Users WHERE user_id = ?';
  
  db.query(sql, [userId], (err, results) => {
    if (err) {
      console.error('관리자 권한 검증 중 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    if (results.length === 0 || results[0].user_role !== 'admin') {
      return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
    }
    
    next();
  });
};