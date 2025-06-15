const db = require('../db');

class AccountDAO {
  // 중복 확인
  static async checkDuplicate(field, value) {
    try {
      const query = `SELECT COUNT(*) as count FROM users WHERE ${field} = ?`;
      const [results] = await db.promise().query(query, [value]);
      return results[0].count > 0;
    } catch (error) {
      console.error('중복 확인 DAO 오류:', error);
      throw error;
    }
  }

  // 사용자 생성
  static async createUser(userData) {
    try {
      const { user_name, user_id, user_nickname, user_password, user_email } =
        userData;
      const query = `
        INSERT INTO users (user_name, user_id, user_nickname, user_password, user_email) 
        VALUES (?, ?, ?, ?, ?)
      `;
      const [result] = await db
        .promise()
        .query(query, [
          user_name,
          user_id,
          user_nickname,
          user_password,
          user_email,
        ]);
      return result;
    } catch (error) {
      console.error('사용자 생성 DAO 오류:', error);
      throw error;
    }
  }

  // 인증 코드 조회
  static async getVerificationCode(email) {
    try {
      const query = 'SELECT * FROM verification_codes WHERE email = ?';
      const [results] = await db.promise().query(query, [email]);
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      console.error('인증 코드 조회 DAO 오류:', error);
      throw error;
    }
  }

  // 인증 코드 생성
  static async createVerificationCode(email, code, expiresAt) {
    try {
      const query = `
        INSERT INTO verification_codes (email, code, expires_at) 
        VALUES (?, ?, ?)
      `;
      const [result] = await db
        .promise()
        .query(query, [email, code, expiresAt]);
      return result;
    } catch (error) {
      console.error('인증 코드 생성 DAO 오류:', error);
      throw error;
    }
  }

  // 인증 코드 업데이트
  static async updateVerificationCode(email, code, expiresAt) {
    try {
      const query = `
        UPDATE verification_codes 
        SET code = ?, expires_at = ?, verified = 0 
        WHERE email = ?
      `;
      const [result] = await db
        .promise()
        .query(query, [code, expiresAt, email]);
      return result;
    } catch (error) {
      console.error('인증 코드 업데이트 DAO 오류:', error);
      throw error;
    }
  }

  // 이메일 인증 완료 처리
  static async markEmailAsVerified(email) {
    try {
      const query =
        'UPDATE verification_codes SET verified = 1 WHERE email = ?';
      const [result] = await db.promise().query(query, [email]);
      return result;
    } catch (error) {
      console.error('이메일 인증 완료 DAO 오류:', error);
      throw error;
    }
  }

  // 사용자 정보 조회 (ID로)
  static async getUserById(userId) {
    try {
      const query = 'SELECT * FROM users WHERE user_id = ?';
      const [results] = await db.promise().query(query, [userId]);
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      console.error('사용자 조회 DAO 오류:', error);
      throw error;
    }
  }

  // 사용자 정보 조회 (이메일로)
  static async getUserByEmail(email) {
    try {
      const query = 'SELECT * FROM users WHERE user_email = ?';
      const [results] = await db.promise().query(query, [email]);
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      console.error('사용자 이메일 조회 DAO 오류:', error);
      throw error;
    }
  }

  // 비밀번호 재설정용 인증 코드 관련 메서드들

  // 사용자 ID와 이메일로 사용자 확인
  static async getUserByIdAndEmail(userId, email) {
    try {
      const query = 'SELECT * FROM users WHERE user_id = ? AND user_email = ?';
      const [results] = await db.promise().query(query, [userId, email]);
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      console.error('사용자 ID/이메일 조회 DAO 오류:', error);
      throw error;
    }
  }

  // 비밀번호 업데이트
  static async updatePassword(userId, hashedPassword) {
    try {
      const query = 'UPDATE users SET user_password = ? WHERE user_id = ?';
      const [result] = await db
        .promise()
        .query(query, [hashedPassword, userId]);
      return result;
    } catch (error) {
      console.error('비밀번호 업데이트 DAO 오류:', error);
      throw error;
    }
  }
}

module.exports = AccountDAO;
