const bodyParser = require('body-parser');
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const locationRoutes = require('./routes/location'); // 위치 API 라우트 추가
// const dbconfig
const app = express()

app.listen(8080, () => {
    console.log('http://localhost:8080 에서 서버 실행중')
})

app.use(cors())
app.use(bodyParser.json())
app.use('/api/auth', authRoutes);
app.use('/api/location', locationRoutes); // 위치 API 경로 설정

app.get('/', (요청, 응답) => {
  응답.send('Tomato')
})