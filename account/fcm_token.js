// account/fcm_token.js
const express = require('express');
const router = express.Router();
const db = require('../db.js');
const jwt = require('jsonwebtoken');

// 환경변수 필수 검증
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET 환경변수가 설정되지 않았습니다.');
}

// 토큰 검증 미들웨어
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: '인증 토큰이 필요합니다.',
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        message: '유효하지 않은 토큰입니다.',
      });
    }

    req.user = user;
    next();
  });
};

// FCM 토큰 저장/업데이트 API
router.post('/', authenticateToken, (req, res) => {
  const { fcm_token } = req.body;
  const user_id = req.user.user_id;

  console.log(`FCM 토큰 저장 요청 받음: ${user_id}`);

  if (!fcm_token) {
    return res.status(400).json({ 
      success: false,
      error: 'FCM 토큰이 필요합니다.' 
    });
  }

  const updateTokenSQL = `UPDATE Users SET fcm_token = ? WHERE user_id = ?`;

  db.query(updateTokenSQL, [fcm_token, user_id], (err, result) => {
    if (err) {
      console.error('FCM 토큰 저장 실패:', err);
      return res.status(500).json({ 
        success: false,
        error: '서버 오류' 
      });
    }

    console.log(`FCM 토큰 저장 성공: ${user_id}`);
    res.json({ 
      success: true, 
      message: 'FCM 토큰이 저장되었습니다.' 
    });
  });
});

module.exports = router;