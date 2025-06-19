// routes/car_expenses.js
const express = require('express');
const router = express.Router();
const db = require('../db.js');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || '7belly_fat4';

// JWT 토큰 검증 미들웨어
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: '인증 토큰이 필요합니다.',
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        message: '유효하지 않은 토큰입니다.',
      });
    }

    req.user = user;
    next();
  });
};

// 날짜 포맷팅 헬퍼 함수
const formatDateOnly = (date) => {
  if (!date) return null;

  // Date 객체로 변환
  const d = new Date(date);

  // 유효한 날짜인지 확인
  if (isNaN(d.getTime())) return null;

  // YYYY-MM-DD 형식으로 반환 (로컬 시간 기준)
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

// 지출 추가
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { expense_type, amount, description, expense_date } = req.body;
    const user_id = req.user.user_id;

    // 필수 필드 검증
    if (!expense_type || !amount || !description || !expense_date) {
      return res.status(400).json({
        success: false,
        message: '모든 필드를 입력해주세요.',
      });
    }

    // 지출 유형 검증
    const validTypes = ['fuel', 'maintenance', 'insurance', 'other'];
    if (!validTypes.includes(expense_type)) {
      return res.status(400).json({
        success: false,
        message: '유효하지 않은 지출 유형입니다.',
      });
    }

    // 금액 검증
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: '유효한 금액을 입력해주세요.',
      });
    }

    // 날짜 검증
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(expense_date)) {
      return res.status(400).json({
        success: false,
        message: '유효한 날짜 형식이 아닙니다 (YYYY-MM-DD).',
      });
    }

    // 데이터베이스에 삽입
    const insertSql = `
      INSERT INTO car_expenses (user_id, expense_type, amount, description, expense_date)
      VALUES (?, ?, ?, ?, ?)
    `;

    const [result] = await db
      .promise()
      .query(insertSql, [
        user_id,
        expense_type,
        numAmount,
        description,
        expense_date,
      ]);

    console.log(`지출 추가 성공 - 사용자: ${user_id}, 금액: ${numAmount}`);

    res.status(201).json({
      success: true,
      message: '지출이 성공적으로 추가되었습니다.',
      expense_id: result.insertId,
    });
  } catch (error) {
    console.error('지출 추가 오류:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
    });
  }
});

// 최근 지출 내역 조회
router.get('/recent', authenticateToken, async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const limit = parseInt(req.query.limit) || 10;

    const sql = `
      SELECT 
        expense_id,
        expense_type,
        amount,
        description,
        DATE_FORMAT(expense_date, '%Y-%m-%d') as expense_date,
        created_at
      FROM car_expenses 
      WHERE user_id = ?
      ORDER BY expense_date DESC, created_at DESC
      LIMIT ?
    `;

    const [results] = await db.promise().query(sql, [user_id, limit]);

    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    console.error('최근 지출 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
    });
  }
});

// 월간 통계 조회
router.get('/monthly', authenticateToken, async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;

    // 이번 달 카테고리별 지출
    const currentMonthSql = `
      SELECT 
        expense_type,
        SUM(amount) as total_amount,
        COUNT(*) as transaction_count
      FROM car_expenses 
      WHERE user_id = ? 
        AND YEAR(expense_date) = ? 
        AND MONTH(expense_date) = ?
      GROUP BY expense_type
    `;

    // 전월 총 지출
    const previousMonth = month === 1 ? 12 : month - 1;
    const previousYear = month === 1 ? year - 1 : year;

    const previousMonthSql = `
      SELECT SUM(amount) as total_amount
      FROM car_expenses 
      WHERE user_id = ? 
        AND YEAR(expense_date) = ? 
        AND MONTH(expense_date) = ?
    `;

    const [currentResults] = await db
      .promise()
      .query(currentMonthSql, [user_id, year, month]);
    const [previousResults] = await db
      .promise()
      .query(previousMonthSql, [user_id, previousYear, previousMonth]);

    // 데이터 정리
    const stats = {
      total: 0,
      fuel: 0,
      maintenance: 0,
      insurance: 0,
      other: 0,
    };

    currentResults.forEach((row) => {
      // 명시적으로 숫자로 변환
      const amount = parseFloat(row.total_amount) || 0;
      stats[row.expense_type] = amount;
      stats.total += amount;
    });

    // 전월 대비 증감률 계산
    const previousTotal = parseFloat(previousResults[0]?.total_amount) || 0;
    let growthRate = 0;
    if (previousTotal > 0) {
      growthRate = ((stats.total - previousTotal) / previousTotal) * 100;
    }

    res.json({
      success: true,
      data: {
        ...stats,
        previous_month_total: parseInt(previousTotal),
        growth_rate: parseFloat(growthRate.toFixed(1)),
        year,
        month,
      },
    });
  } catch (error) {
    console.error('월간 통계 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
    });
  }
});

// 일별 지출 조회 (캘린더용) - 개선된 버전
router.get('/daily', authenticateToken, async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;

    console.log(
      `일별 지출 조회 요청 - 사용자: ${user_id}, 년: ${year}, 월: ${month}`
    );

    // 먼저 해당 사용자의 지출이 있는지 확인
    const checkSql = `SELECT COUNT(*) as count FROM car_expenses WHERE user_id = ?`;
    const [checkResults] = await db.promise().query(checkSql, [user_id]);
    console.log(`사용자 ${user_id}의 총 지출 건수: ${checkResults[0].count}`);

    // GROUP BY와 호환되도록 쿼리 수정
    const sql = `
      SELECT 
        DAY(expense_date) as day,
        SUM(amount) as daily_total,
        COUNT(*) as transaction_count,
        DATE(expense_date) as expense_date_only
      FROM car_expenses 
      WHERE user_id = ? 
        AND YEAR(expense_date) = ? 
        AND MONTH(expense_date) = ?
      GROUP BY DAY(expense_date), DATE(expense_date)
      ORDER BY day
    `;

    console.log('SQL 쿼리 실행:', sql);
    console.log('쿼리 파라미터:', [user_id, year, month]);

    const [results] = await db.promise().query(sql, [user_id, year, month]);

    console.log('SQL 쿼리 결과 건수:', results.length);
    console.log('SQL 쿼리 결과:', results);

    // 결과를 객체로 변환 (day를 키로 사용)
    const dailyData = {};
    results.forEach((row) => {
      // 안전한 타입 변환
      const total = parseFloat(row.daily_total) || 0;
      const count = parseInt(row.transaction_count) || 0;

      // 날짜 포맷팅 (YYYY-MM-DD 형식으로)
      const expenseDate = new Date(row.expense_date_only);
      const formattedDate = `${expenseDate.getFullYear()}-${String(
        expenseDate.getMonth() + 1
      ).padStart(2, '0')}-${String(expenseDate.getDate()).padStart(2, '0')}`;

      dailyData[row.day.toString()] = {
        total: total,
        count: count,
        date: formattedDate,
      };

      console.log(
        `날짜 ${row.day}: 총액 ${total}, 건수 ${count}, 포맷된 날짜: ${formattedDate}`
      );
    });

    console.log('최종 반환 데이터:', dailyData);

    res.json({
      success: true,
      data: dailyData,
      year,
      month,
      debug: {
        totalExpenses: checkResults[0].count,
        queryResults: results.length,
      },
    });
  } catch (error) {
    console.error('일별 지출 조회 오류 상세:', error);
    console.error('에러 스택:', error.stack);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
      error: error.message,
      stack: error.stack,
    });
  }
});

// 특정 날짜의 지출 조회 (새로 추가)
router.get('/date/:date', authenticateToken, async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const { date } = req.params;

    // 날짜 형식 검증
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        success: false,
        message: '유효한 날짜 형식이 아닙니다 (YYYY-MM-DD).',
      });
    }

    const sql = `
      SELECT 
        expense_id,
        expense_type,
        amount,
        description,
        DATE_FORMAT(expense_date, '%Y-%m-%d') as expense_date,
        created_at
      FROM car_expenses 
      WHERE user_id = ? 
        AND DATE(expense_date) = ?
      ORDER BY created_at DESC
    `;

    const [results] = await db.promise().query(sql, [user_id, date]);

    res.json({
      success: true,
      data: results,
      date: date,
    });
  } catch (error) {
    console.error('특정 날짜 지출 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
    });
  }
});

// 카테고리별 통계 조회
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;

    const sql = `
      SELECT 
        expense_type,
        SUM(amount) as total_amount,
        COUNT(*) as transaction_count,
        AVG(amount) as average_amount,
        MIN(amount) as min_amount,
        MAX(amount) as max_amount
      FROM car_expenses 
      WHERE user_id = ? 
        AND YEAR(expense_date) = ? 
        AND MONTH(expense_date) = ?
      GROUP BY expense_type
      ORDER BY total_amount DESC
    `;

    const [results] = await db.promise().query(sql, [user_id, year, month]);

    // 총합 계산
    const totalAmount = results.reduce(
      (sum, row) => sum + parseInt(row.total_amount),
      0
    );

    // 비율 계산
    const statsWithPercentage = results.map((row) => ({
      expense_type: row.expense_type,
      total_amount: parseInt(row.total_amount),
      transaction_count: row.transaction_count,
      average_amount: parseFloat(row.average_amount),
      min_amount: parseInt(row.min_amount),
      max_amount: parseInt(row.max_amount),
      percentage:
        totalAmount > 0 ? parseInt(row.total_amount) / totalAmount : 0,
    }));

    res.json({
      success: true,
      data: {
        categories: statsWithPercentage,
        total_amount: totalAmount,
        year,
        month,
      },
    });
  } catch (error) {
    console.error('카테고리별 통계 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
    });
  }
});

// 지출 삭제
router.delete('/:expense_id', authenticateToken, async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const expense_id = parseInt(req.params.expense_id);

    if (isNaN(expense_id)) {
      return res.status(400).json({
        success: false,
        message: '유효하지 않은 지출 ID입니다.',
      });
    }

    // 해당 사용자의 지출인지 확인 후 삭제
    const deleteSql = `
      DELETE FROM car_expenses 
      WHERE expense_id = ? AND user_id = ?
    `;

    const [result] = await db.promise().query(deleteSql, [expense_id, user_id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: '삭제할 지출을 찾을 수 없습니다.',
      });
    }

    console.log(`지출 삭제 성공 - 사용자: ${user_id}, 지출ID: ${expense_id}`);

    res.json({
      success: true,
      message: '지출이 성공적으로 삭제되었습니다.',
    });
  } catch (error) {
    console.error('지출 삭제 오류:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
    });
  }
});

module.exports = router;
