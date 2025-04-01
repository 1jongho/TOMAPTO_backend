const connection = require('./db');

// 데이터 삽입
const insertUser = (name, email) => {
  const sql = 'INSERT INTO users (name, email) VALUES (?, ?)';
  connection.query(sql, [name, email], (err, results) => {
    if (err) {
      console.error('데이터 삽입 오류:', err);
      return;
    }
    console.log('사용자 추가 성공:', results.insertId);
  });
};

// 데이터 조회
const getUsers = () => {
  const sql = 'SELECT * FROM users';
  connection.query(sql, (err, results) => {
    if (err) {
      console.error('데이터 조회 오류:', err);
      return;
    }
    console.log('사용자 목록:', results);
  });
};