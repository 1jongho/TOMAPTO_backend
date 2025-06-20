// account/delete_account.js (최종 수정된 회원탈퇴 백엔드)
require("dotenv").config();
const express = require("express");
const router = express.Router();
const db = require("../db.js");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret";

// 헬스체크 엔드포인트
router.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "회원탈퇴 서비스가 정상 작동 중입니다.",
    timestamp: new Date().toISOString(),
    server_status: "healthy"
  });
});

// 토큰 검증 미들웨어
const authenticateToken = (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    console.log(`인증 토큰 검증 시작: ${token ? "토큰 존재" : "토큰 없음"}`);

    if (!token) {
      console.log("토큰이 제공되지 않음");
      return res.status(401).json({
        success: false,
        message: "인증 토큰이 필요합니다.",
        error_code: "NO_TOKEN"
      });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        console.error("JWT 검증 오류:", err.name, err.message);
        
        let errorMessage = "유효하지 않은 토큰입니다.";
        let errorCode = "INVALID_TOKEN";
        
        if (err.name === 'TokenExpiredError') {
          errorMessage = "토큰이 만료되었습니다. 다시 로그인해주세요.";
          errorCode = "TOKEN_EXPIRED";
        } else if (err.name === 'JsonWebTokenError') {
          errorMessage = "잘못된 토큰 형식입니다.";
          errorCode = "MALFORMED_TOKEN";
        }
        
        return res.status(403).json({
          success: false,
          message: errorMessage,
          error_code: errorCode
        });
      }

      console.log(`토큰 검증 성공 - 사용자 ID: ${user.user_id}`);
      req.user = user;
      next();
    });
  } catch (error) {
    console.error("인증 미들웨어 예외:", error);
    return res.status(500).json({
      success: false,
      message: "인증 처리 중 서버 오류가 발생했습니다.",
      error_code: "AUTH_SERVER_ERROR"
    });
  }
};

// 다양한 해시 방식으로 비밀번호 비교하는 함수
async function comparePasswordMultipleFormats(inputPassword, storedHash) {
  try {
    console.log(`=== 비밀번호 비교 시작 ===`);
    console.log(`입력 비밀번호 길이: ${inputPassword?.length}자`);
    console.log(`저장된 해시 앞 20자: ${storedHash?.substring(0, 20)}...`);
    
    if (!inputPassword || !storedHash) {
      console.log("비밀번호 또는 해시가 비어있음");
      return false;
    }
    
    // 1. bcrypt 형식 확인 및 비교
    if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$')) {
      console.log('bcrypt 형식 해시 감지, bcrypt.compare 사용');
      const bcryptResult = await bcrypt.compare(inputPassword, storedHash);
      console.log(`bcrypt 비교 결과: ${bcryptResult}`);
      return bcryptResult;
    }
    
    // 2. 평문 비교
    if (inputPassword === storedHash) {
      console.log('평문 비교 성공');
      return true;
    }
    
    // 3. 다양한 해시 방식으로 비교
    const hashMethods = [
      { name: 'SHA256', hash: crypto.createHash('sha256').update(inputPassword).digest('hex') },
      { name: 'MD5', hash: crypto.createHash('md5').update(inputPassword).digest('hex') },
      { name: 'SHA1', hash: crypto.createHash('sha1').update(inputPassword).digest('hex') }
    ];
    
    for (const method of hashMethods) {
      if (method.hash === storedHash) {
        console.log(`✅ ${method.name} 해시 방식으로 비교 성공`);
        return true;
      }
    }
    
    console.log('❌ 모든 해시 방식으로 비교 실패');
    return false;
    
  } catch (error) {
    console.error('비밀번호 비교 중 오류:', error);
    return false;
  }
}

// 데이터베이스 연결 상태 확인 함수
async function checkDatabaseConnection() {
  try {
    const connection = await db.promise().getConnection();
    await connection.query('SELECT 1');
    connection.release();
    console.log('데이터베이스 연결 상태: 정상');
    return true;
  } catch (error) {
    console.error('데이터베이스 연결 실패:', error);
    return false;
  }
}

// 테이블 존재 여부 확인 함수
async function checkTableExists(connection, tableName) {
  try {
    const [result] = await connection.query(
      `SELECT COUNT(*) as count FROM information_schema.tables 
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [tableName]
    );
    return result[0].count > 0;
  } catch (error) {
    console.error(`테이블 ${tableName} 존재 확인 오류:`, error);
    return false;
  }
}

// 사용자 관련 데이터 완전 삭제 함수
async function deleteAllUserData(connection, userId, userEmail) {
  console.log(`\n🗑️ 사용자 관련 데이터 완전 삭제 시작 (사용자: ${userId})...`);
  
  // 삭제할 테이블들과 조건들 정의 (외래키 제약을 고려한 순서)
  const tablesToDelete = [
    {
      name: 'car_expenses',
      condition: 'user_id = ?',
      params: [userId],
      description: '자동차 비용 기록'
    },
    {
      name: 'locationsharing',
      condition: 'sharer_id = ? OR sharee_id = ?',
      params: [userId, userId],
      description: '위치 공유 관계'
    },
    {
      name: 'location',
      condition: 'user_id = ?',
      params: [userId],
      description: '위치 정보'
    },
    {
      name: 'friendships',
      condition: 'user_id_1 = ? OR user_id_2 = ?',
      params: [userId, userId],
      description: '친구 관계'
    },
    {
      name: 'friendrequests',
      condition: 'sender_id = ? OR recipient_id = ?',
      params: [userId, userId],
      description: '친구 요청'
    },
    {
      name: 'verification_codes',
      condition: 'email = ?',
      params: [userEmail],
      description: '이메일 인증 코드'
    }
  ];

  let totalDeletedRecords = 0;
  const deletionResults = [];

  for (const table of tablesToDelete) {
    try {
      console.log(`\n🔍 ${table.name} (${table.description}) 테이블 처리 중...`);
      
      // 테이블 존재 확인
      const tableExists = await checkTableExists(connection, table.name);
      
      if (!tableExists) {
        console.log(`ℹ️ ${table.name} 테이블이 존재하지 않음 - 건너뜀`);
        deletionResults.push({
          table: table.name,
          status: 'table_not_exists',
          deletedCount: 0
        });
        continue;
      }
      
      // 데이터 개수 확인
      const checkSQL = `SELECT COUNT(*) as count FROM ${table.name} WHERE ${table.condition}`;
      const [countResult] = await connection.query(checkSQL, table.params);
      const recordCount = countResult[0].count;
      
      console.log(`📊 ${table.name} 테이블에서 ${recordCount}개 레코드 발견`);
      
      if (recordCount > 0) {
        // 데이터 삭제
        const deleteSQL = `DELETE FROM ${table.name} WHERE ${table.condition}`;
        const [deleteResult] = await connection.query(deleteSQL, table.params);
        const deletedCount = deleteResult.affectedRows;
        totalDeletedRecords += deletedCount;
        
        console.log(`✅ ${table.name} 테이블 삭제 완료: ${deletedCount}개 레코드 삭제됨`);
        deletionResults.push({
          table: table.name,
          status: 'success',
          deletedCount: deletedCount
        });
      } else {
        console.log(`ℹ️ ${table.name} 테이블: 삭제할 데이터 없음`);
        deletionResults.push({
          table: table.name,
          status: 'no_data',
          deletedCount: 0
        });
      }
    } catch (tableError) {
      console.error(`❌ ${table.name} 테이블 처리 중 오류:`, tableError.message);
      deletionResults.push({
        table: table.name,
        status: 'error',
        deletedCount: 0,
        error: tableError.message
      });
      // 개별 테이블 오류는 로그만 남기고 계속 진행
    }
  }

  console.log(`📊 사용자 관련 데이터 삭제 완료 - 총 ${totalDeletedRecords}개 레코드 삭제됨`);
  console.log(`📋 삭제 상세 결과:`, deletionResults);
  
  return { totalDeletedRecords, deletionResults };
}

// 사용자 계정 완전 삭제 함수 (최종 수정된 안전한 버전)
async function deleteUserAccount(connection, userId) {
  console.log(`\n👤 사용자 계정 삭제 처리 중 (ID: ${userId})...`);
  
  try {
    // 외래 키 제약 조건 임시 비활성화
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    console.log('🔓 외래 키 제약 조건 임시 비활성화');
    
    // 사용자 계정 삭제
    const deleteUserSQL = `DELETE FROM users WHERE user_id = ?`;
    const [deleteResult] = await connection.query(deleteUserSQL, [userId]);
    
    // 외래 키 제약 조건 재활성화
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('🔒 외래 키 제약 조건 재활성화');
    
    console.log(`📊 사용자 계정 삭제 결과: ${deleteResult.affectedRows}개 레코드 삭제됨`);
    
    if (deleteResult.affectedRows === 0) {
      throw new Error('사용자 계정 삭제 실패: 영향받은 레코드 없음');
    }
    
    console.log(`✅ 사용자 계정 삭제 완료`);
    return true;
    
  } catch (error) {
    console.error(`❌ 사용자 계정 삭제 실패:`, error);
    
    // 오류 발생시에도 외래 키 제약 조건 재활성화
    try {
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
      console.log('🔒 오류 발생으로 인한 외래 키 제약 조건 재활성화');
    } catch (fkError) {
      console.error('외래 키 제약 조건 재활성화 실패:', fkError);
    }
    
    throw error;
  }
}

// 회원탈퇴 API 메인 함수
router.post("/", authenticateToken, async (req, res) => {
  let connection;
  const startTime = Date.now();
  
  try {
    const { password } = req.body;
    const userId = req.user.user_id;

    console.log(`\n🚀 === 회원탈퇴 요청 시작 ===`);
    console.log(`📋 요청 정보:`);
    console.log(`  - 사용자 ID: ${userId}`);
    console.log(`  - 비밀번호 입력됨: ${password ? '✅' : '❌'}`);
    console.log(`  - 요청 시간: ${new Date().toISOString()}`);
    console.log(`  - IP 주소: ${req.ip || req.connection.remoteAddress}`);

    // 입력값 검증
    if (!password || password.trim() === '') {
      console.log('❌ 비밀번호 누락');
      return res.status(400).json({
        success: false,
        message: "비밀번호를 입력해주세요.",
        error_code: "MISSING_PASSWORD"
      });
    }

    // 데이터베이스 연결 상태 확인
    const dbHealthy = await checkDatabaseConnection();
    if (!dbHealthy) {
      console.error('❌ 데이터베이스 연결 불가');
      return res.status(503).json({
        success: false,
        message: "데이터베이스 서비스를 이용할 수 없습니다. 잠시 후 다시 시도해주세요.",
        error_code: "DATABASE_UNAVAILABLE"
      });
    }

    // 데이터베이스 연결
    console.log(`\n🔌 데이터베이스 연결 중...`);
    connection = await db.promise().getConnection();
    console.log(`✅ 데이터베이스 연결 성공`);

    // 사용자 정보 조회
    console.log(`\n👤 사용자 정보 조회 중...`);
    const getUserSQL = "SELECT * FROM users WHERE user_id = ?";
    
    const [userResults] = await connection.query(getUserSQL, [userId]);
    console.log(`📊 사용자 조회 결과: ${userResults.length}개 레코드 발견`);

    if (userResults.length === 0) {
      console.log('❌ 사용자 정보 없음');
      return res.status(404).json({
        success: false,
        message: "사용자 정보를 찾을 수 없습니다.",
        error_code: "USER_NOT_FOUND"
      });
    }

    const user = userResults[0];
    console.log(`✅ 사용자 정보 발견: ${user.user_id} (이메일: ${user.user_email})`);

    // 사용자 상태 확인
    if (user.user_status && user.user_status === 'deleted') {
      console.log(`❌ 이미 탈퇴된 사용자: ${user.user_status}`);
      return res.status(400).json({
        success: false,
        message: "이미 탈퇴된 계정입니다.",
        error_code: "ALREADY_DELETED"
      });
    }
    
    // 비밀번호 확인
    console.log(`\n🔐 비밀번호 확인 중...`);
    const isPasswordValid = await comparePasswordMultipleFormats(password.trim(), user.user_password);
    
    if (!isPasswordValid) {
      console.log(`❌ 비밀번호 불일치 - 사용자: ${userId}`);
      return res.status(401).json({
        success: false,
        message: "비밀번호가 일치하지 않습니다.",
        error_code: "INVALID_PASSWORD"
      });
    }

    console.log(`✅ 비밀번호 확인 성공 - 탈퇴 처리 진행`);

    // 트랜잭션 시작
    console.log(`\n🔄 트랜잭션 시작...`);
    await connection.beginTransaction();

    try {
      // 1. 관련 테이블 데이터 완전 삭제
      const deletionResult = await deleteAllUserData(connection, userId, user.user_email);

      // 2. 사용자 계정 완전 삭제
      await deleteUserAccount(connection, userId);

      // 트랜잭션 커밋
      console.log(`\n✅ 트랜잭션 커밋 중...`);
      await connection.commit();
      
      const processingTime = Date.now() - startTime;
      console.log(`🎉 회원탈퇴 처리 완료: ${userId}`);
      console.log(`📅 완료 시간: ${new Date().toISOString()}`);
      console.log(`⏱️ 처리 시간: ${processingTime}ms`);
      console.log(`📊 삭제된 관련 레코드: ${deletionResult.totalDeletedRecords}개`);
      
      // 성공 응답
      res.status(200).json({
        success: true,
        message: "회원탈퇴가 정상적으로 처리되었습니다.",
        data: {
          user_id: userId,
          processed_at: new Date().toISOString(),
          processing_time_ms: processingTime,
          deleted_records: deletionResult.totalDeletedRecords,
          deletion_details: deletionResult.deletionResults
        }
      });

    } catch (transactionError) {
      // 트랜잭션 롤백
      console.error(`\n❌ 트랜잭션 오류 발생:`, transactionError);
      console.log(`🔄 트랜잭션 롤백 중...`);
      await connection.rollback();
      console.log(`✅ 트랜잭션 롤백 완료`);
      
      // 구체적인 오류 메시지 제공
      let errorMessage = "회원탈퇴 처리 중 오류가 발생했습니다.";
      let errorCode = "TRANSACTION_ERROR";
      
      if (transactionError.code === 'ER_NO_SUCH_TABLE') {
        errorMessage = "데이터베이스 테이블 구조에 문제가 있습니다.";
        errorCode = "TABLE_NOT_FOUND";
      } else if (transactionError.code === 'ER_ACCESS_DENIED_ERROR') {
        errorMessage = "데이터베이스 권한 문제가 발생했습니다.";
        errorCode = "ACCESS_DENIED";
      } else if (transactionError.code === 'ER_LOCK_WAIT_TIMEOUT') {
        errorMessage = "데이터베이스가 일시적으로 바쁩니다. 잠시 후 다시 시도해주세요.";
        errorCode = "LOCK_TIMEOUT";
      }
      
      res.status(500).json({
        success: false,
        message: errorMessage,
        error_code: errorCode,
        error_time: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error(`\n💥 회원탈퇴 API 전체 오류:`, error);
    
    // 구체적인 오류 메시지 제공
    let errorMessage = "서버 오류가 발생했습니다.";
    let errorCode = "INTERNAL_SERVER_ERROR";
    let statusCode = 500;
    
    if (error.code === 'ECONNREFUSED') {
      errorMessage = "데이터베이스 연결에 실패했습니다.";
      errorCode = "DATABASE_CONNECTION_FAILED";
      statusCode = 503;
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      errorMessage = "데이터베이스 인증에 실패했습니다.";
      errorCode = "DATABASE_AUTH_FAILED";
      statusCode = 503;
    } else if (error.code === 'ETIMEDOUT') {
      errorMessage = "요청 처리 시간이 초과되었습니다.";
      errorCode = "REQUEST_TIMEOUT";
      statusCode = 504;
    }
    
    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error_code: errorCode,
      error_time: new Date().toISOString()
    });
  } finally {
    // 연결 해제
    if (connection) {
      console.log(`\n🔌 데이터베이스 연결 해제`);
      connection.release();
    }
    const totalTime = Date.now() - startTime;
    console.log(`\n🏁 === 회원탈퇴 요청 종료 (총 소요시간: ${totalTime}ms) ===\n`);
  }
});

// 탈퇴 상태 확인 API
router.get("/status/:userId", authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const requestUserId = req.user.user_id;

    console.log(`탈퇴 상태 확인 요청: ${requestUserId} -> ${userId}`);

    // 본인만 조회 가능
    if (requestUserId !== userId) {
      return res.status(403).json({
        success: false,
        message: "본인의 계정 상태만 조회할 수 있습니다.",
        error_code: "ACCESS_DENIED"
      });
    }

    const [userResults] = await db.promise().query(
      "SELECT user_id, user_status, user_created_at, user_updated_at FROM users WHERE user_id = ?",
      [userId]
    );

    if (userResults.length === 0) {
      return res.status(404).json({
        success: false,
        message: "사용자를 찾을 수 없습니다. 이미 탈퇴되었을 수 있습니다.",
        error_code: "USER_NOT_FOUND"
      });
    }

    const user = userResults[0];

    res.status(200).json({
      success: true,
      data: {
        user_id: user.user_id,
        status: user.user_status || 'active',
        is_deleted: user.user_status === 'deleted',
        created_at: user.user_created_at,
        updated_at: user.user_updated_at
      }
    });

  } catch (error) {
    console.error('탈퇴 상태 확인 오류:', error);
    res.status(500).json({
      success: false,
      message: "서버 오류가 발생했습니다.",
      error_code: "INTERNAL_SERVER_ERROR"
    });
  }
});

module.exports = router;