require('dotenv').config();
const bodyParser = require('body-parser');
const express = require('express');
const cors = require('cors');
const app = express();

// 새로운 회원가입 라우트 (리팩토링된 버전)
const newAccountRoutes = require('./routes/account_routes');
const loginRoutes = require('./account/login');
const profileRoutes = require('./account/profile');
const profileEditRoutes = require('./account/profils_edit');
const logoutRoutes = require('./account/logout');
const locationRoutes = require('./routes/location');
const friendsRoutes = require('./routes/friends');
const deleteAccountRoutes = require('./account/delete_account');

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

// 새로운 회원가입 라우트 (리팩토링된 버전)
app.use('/api/account', newAccountRoutes);

// 기존 라우트들 (회원가입 관련 제외)
app.use('/api/account/login', loginRoutes);
app.use('/api/account/profile', profileRoutes);
app.use('/api/account/profile-edit', profileEditRoutes);
app.use('/api/account/logout', logoutRoutes);
app.use('/api/location', locationRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/account/delete', deleteAccountRoutes);

// HTTP 서버 생성 및 소켓 서버 설정
const server = require('http').createServer(app);
const initSocketServer = require('./socket');

// 소켓 서버 초기화
const io = initSocketServer(server);

// 서버 시작
server.listen(8080, process.env.IP || '0.0.0.0', () => {
  console.log('http://localhost:8080 에서 서버 실행중');
});
