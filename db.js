require('dotenv').config();
const mysql = require('mysql2')

const connection = mysql.createConnection({
    host: process.env.DB_HOST,//Mysql 서버 주소
    port: process.env.DB_PORT,//port
    user: process.env.DB_USER, //Mysql 계정
    password: process.env.DB_PASS,//비밀번호
    database: process.env.DB_NAME,//사용할 데이터베이스
    waitForConnections: true, //대기열을 넣을지 말지 , 
    connectionLimit: 10, // 연결하는 사람을 10명으로 설정
    queueLimit: 0 // 무한 대기열 허용
});

connection.connect((err)=>{
    if(err){
        console.error('MySQL 연결 실패: ',err);
        return;
    }

    console.log('MySQL 연결 성공');
});

module.exports = connection; 