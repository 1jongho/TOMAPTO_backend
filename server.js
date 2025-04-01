const bodyParser = require('body-parser');
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
// const dbconfig
const app = express()

app.listen(8080, () => {
    console.log('http://localhost:8080 에서 서버 실행중')
})

app.use(cors())
app.use(bodyParser.json())
app.use('/api/auth', authRoutes);

app.get('/', (요청, 응답) => {
  응답.send('Tomato')
}) 