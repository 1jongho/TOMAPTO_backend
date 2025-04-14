// server.js
require("dotenv").config();
const bodyParser = require("body-parser");
const express = require("express");
const cors = require("cors");
const app = express();
const accountRoutes = require("./account/signup"); // signup.js 파일도 함께 실행
const loginRoutes = require("./account/login"); // login.js 파일 추가
const profileRoutes = require("./account/profile"); // profile.js 파일 추가
const logoutRoutes = require("./account/logout"); // logout.js 파일 추가
const db = require("./db.js"); // db.js 파일도 함께 실행

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

// 서버 시작
app.listen(8080, "0.0.0.0", () => {
  console.log("http://localhost:8080 에서 서버 실행중");
});
