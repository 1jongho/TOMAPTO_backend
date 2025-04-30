require("dotenv").config();
const bodyParser = require("body-parser");
const express = require("express");
const cors = require("cors");
const app = express();

const accountRoutes = require("./account/signup");
const loginRoutes = require("./account/login");
const profileRoutes = require("./account/profile");
const logoutRoutes = require("./account/logout");
const emailVerificationRoutes = require("./account/email_verification");

const locationRoutes = require("./routes/location"); // location.js 파일 추가 (위치 관련)
const friendsRoutes = require("./routes/friends"); // friends.js 파일 추가 (친구 관련)

// 미들웨어 설정
app.use(
  cors({
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(bodyParser.json());

// 기본 라우트
app.get("/", (res, req) => {
  req.send("tomapto");
});

app.get("/api/account", (res, req) => {
  req.send("/api/account req send.");
});
app.get("/api/account/login", (res, req) => {
  req.send("/api/account/login req send.");
});
app.get("/api/account/signup", (res, req) => {
  req.send("/api/account/signup req send.");
});

// 회원가입 및 로그인 관련 라우트 설정
app.use("/api/account", accountRoutes);
app.use("/api/account/login", loginRoutes); // 로그인 라우트
app.use("/api/account/profile", profileRoutes); // 프로필 라우트
app.use("/api/account/logout", logoutRoutes); // 로그아웃 라우트 추가
app.use("/api/account/verification", emailVerificationRoutes); // 이메일 인증 라우트 추가

// 위치 관련 라우트 설정
app.use("/api/location", locationRoutes);
app.use("/api/friends", friendsRoutes); // 친구 라우트

// HTTP 서버 생성 및 소켓 서버 설정
const server = require("http").createServer(app);
const initSocketServer = require("./socket"); // socket.js 파일 가져오기

// 소켓 서버 초기화
const io = initSocketServer(server);

// 서버 시작
app.listen(8080, process.env.IP, () => {
  console.log("http://localhost:8080 에서 서버 실행중");
});
