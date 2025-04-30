require("dotenv").config();
const mysql = require("mysql2");

// 연결 풀 생성
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
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
  pool.query("SELECT 1");
  console.log("데이터베이스 연결 유지 쿼리 실행");
}, 60000); // 1분마다 실행

module.exports = pool;
