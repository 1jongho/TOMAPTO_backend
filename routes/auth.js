// routes/auth.js
const express = require('express');
const db = require('../db'); // DB 연결 파일
const router = express.Router();

// ✅ 회원가입 API
router.post('/register', (req, res) => {
  const { name, email } = req.body;

  const sql = 'INSERT INTO users (name, email) VALUES (?, ?)';
  db.query(sql, [name, email], (err, result) => {
    if (err) {
      console.error('회원가입 실패:', err);
      return res.status(500).json({ error: '회원가입 실패' });
    }
    res.status(201).json({ message: '회원가입 성공', userId: result.insertId });
  });
});

// ✅ 사용자 전체 조회 API
router.get('/users', (req, res) => {
  const sql = 'SELECT * FROM users';
  db.query(sql, (err, results) => {
    if (err) {
      console.error('사용자 조회 실패:', err);
      return res.status(500).json({ error: '조회 실패' });
    }
    res.status(200).json(results);
  });
});

module.exports = router;