const bodyParser = require('body-parser');
const express = require('express');
const cors = require('cors');
const app = express();

const accountRoutes = require('./account/signup'); //signup.js 파일도 함께 실행
const db = require('./db.js'); //db.js 파일도 함께 실행

// 미들웨어 설정
app.use(cors());
app.use(bodyParser.json());

// 기본 라우트
app.get('/', (요청, 응답) => {
  응답.send('tomapto')
});

// 회원가입 관련 라우트 설정
app.use('/api/account', accountRoutes);

// 서버 시작

app.listen(8080,() => {
  console.log('http://localhost:8080 에서 서버 실행중')
});