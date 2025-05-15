require("dotenv").config();
const mysql = require("mysql2");

// 연결 풀 생성
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || '3306',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'tomapto_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 60000, // 연결 타임아웃 60초로 설정
});

// 프로미스 래핑
const promisePool = pool.promise();

// 연결 테스트
pool.getConnection((err, connection) => {
  if (err) {
    console.error("MySQL 연결 실패: ", err);
    return;
  }

  console.log("MySQL 연결 성공");
  connection.release(); // 연결 반환
});

// 주기적으로 연결 유지 (keepalive)
setInterval(() => {
  // 프로미스가 아닌 일반 쿼리로 수정
  pool.query("SELECT 1", (err, results) => {
    if (err) {
      console.error("데이터베이스 연결 유지 쿼리 실패:", err);
    } else {
      console.log("데이터베이스 연결 유지 쿼리 성공");
    }
  });
}, 60000); // 1분마다 실행

module.exports = pool;