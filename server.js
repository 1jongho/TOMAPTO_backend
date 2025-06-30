require('dotenv').config();
const bodyParser = require('body-parser');
const express = require('express');
const cors = require('cors');
const app = express();
const accountRoutes = require('./account/signup');
const loginRoutes = require('./account/login');
const profileRoutes = require('./account/profile');
const profileEditRoutes = require('./account/profils_edit'); // 프로필 편집 라우트 추가
const logoutRoutes = require('./account/logout');
const emailVerificationRoutes = require('./account/email_verification');
const locationRoutes = require('./routes/location'); // location.js 파일 추가 (위치 관련)
const friendsRoutes = require('./routes/friends'); // friends.js 파일 추가 (친구 관련)
const deleteAccountRoutes = require('./account/delete_account');
const carExpensesRoutes = require('./routes/car_expenses');
const followRoutes = require("./routes/follow");


// 미들웨어 설정
app.use(
  cors({
    origin: '*', // 모든 오리진 허용 (개발 환경용)
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(bodyParser.json());

// 기본 라우트
app.get('/', (req, res) => {
  res.send('tomapto');
});
app.get('/api/account', (req, res) => {
  res.send('/api/account req send.');
});
app.get('/api/account/login', (req, res) => {
  res.send('/api/account/login req send.');
});
app.get('/api/account/signup', (req, res) => {
  res.send('/api/account/signup req send.');
});

// 회원가입 및 로그인 관련 라우트 설정
app.use('/api/account', accountRoutes);
app.use('/api/account/login', loginRoutes); // 로그인 라우트
app.use('/api/account/profile', profileRoutes); // 프로필 라우트
app.use('/api/account/profile-edit', profileEditRoutes); // 프로필 편집 라우트 추가
app.use('/api/account/logout', logoutRoutes); // 로그아웃 라우트 추가
app.use('/api/account/verification', emailVerificationRoutes); // 이메일 인증 라우트 추가

// 비밀번호 재설정 라우트도 동일한 emailVerificationRoutes 사용
app.use('/api/account/password-reset', emailVerificationRoutes); // 비밀번호 재설정 라우트 추가

// 위치 관련 라우트 설정
app.use('/api/location', locationRoutes);
app.use('/api/friends', friendsRoutes); // 친구 라우트
app.use('/api/account/delete', deleteAccountRoutes);
app.use('/api/car-expenses', carExpensesRoutes);
app.use("/api/follow", followRoutes);


// HTTP 서버 생성 및 소켓 서버 설정
const server = require('http').createServer(app);

// 소켓 서버 초기화
const { initSocketServer } = require('./socket.js');
const io = initSocketServer(server);

// Express 앱에 io 인스턴스 추가 (follow.js에서 사용하기 위해)
app.set('io', io);
app.set('connectedUsers', require('./socket.js').connectedUsers); 

// 서버 시작
server.listen(8080, process.env.IP || '0.0.0.0', () => {
  console.log('http://localhost:8080 에서 서버 실행중');
});