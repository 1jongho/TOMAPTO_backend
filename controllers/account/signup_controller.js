// controllers/account/signup_controller.js
const accountDAO = require('../../models/accountDAO');
const EmailVerificationController = require('./email_verification_controller');
const crypto = require('crypto');

class SignupController {
  // SHA-256 해시 함수
  static sha256Hash(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  // 중복 확인 처리
  static async checkDuplicate(req, res) {
    try {
      const { field, value } = req.query;

      // 입력 검증
      if (!field || !value) {
        return res
          .status(400)
          .json({ message: '필수 파라미터가 누락되었습니다.' });
      }

      // 허용된 필드만 확인
      const allowedFields = ['user_id', 'user_nickname', 'user_email'];
      if (!allowedFields.includes(field)) {
        return res.status(400).json({ message: '유효하지 않은 필드입니다.' });
      }

      const isDuplicate = await accountDAO.checkDuplicate(field, value);
      return res.json({ isDuplicate });
    } catch (error) {
      console.error('중복 확인 오류:', error);
      return res.status(500).json({ message: '서버 오류가 발생했습니다.' });
    }
  }

  // 회원가입 처리
  static async signup(req, res) {
    try {
      const { user_name, user_id, user_nickname, user_password, user_email } =
        req.body;

      // 필수 필드 검증
      if (
        !user_name ||
        !user_id ||
        !user_nickname ||
        !user_password ||
        !user_email
      ) {
        return res.status(400).json({ message: '모든 필드를 입력해주세요.' });
      }

      // 아이디 중복 확인
      const idDuplicate = await accountDAO.checkDuplicate('user_id', user_id);
      if (idDuplicate) {
        return res
          .status(400)
          .json({ message: '이미 사용 중인 아이디입니다.' });
      }

      // 닉네임 중복 확인
      const nicknameDuplicate = await accountDAO.checkDuplicate(
        'user_nickname',
        user_nickname
      );
      if (nicknameDuplicate) {
        return res
          .status(400)
          .json({ message: '이미 사용 중인 닉네임입니다.' });
      }

      // 이메일 중복 확인
      const emailDuplicate = await accountDAO.checkDuplicate(
        'user_email',
        user_email
      );
      if (emailDuplicate) {
        return res
          .status(400)
          .json({ message: '이미 사용 중인 이메일입니다.' });
      }

      // 비밀번호 해시화
      const hashedPassword = SignupController.sha256Hash(user_password);
      console.log(
        '비밀번호 해시 처리 완료:',
        user_password.substring(0, 3) + '*** → SHA-256 해시됨'
      );

      // 사용자 생성
      const userData = {
        user_name,
        user_id,
        user_nickname,
        user_password: hashedPassword,
        user_email,
      };

      await accountDAO.createUser(userData);
      return res.status(201).json({ message: '회원가입이 완료되었습니다.' });
    } catch (error) {
      console.error('회원가입 오류:', error);
      return res.status(500).json({ message: '서버 오류가 발생했습니다.' });
    }
  }

  // 이메일 인증번호 발송
  static async sendVerificationEmail(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: '이메일 주소가 필요합니다.' });
      }

      // EmailVerificationController 사용
      const result =
        await EmailVerificationController.sendSignupVerificationEmail(email);

      if (result.success) {
        return res.status(200).json({ message: result.message });
      } else {
        return res.status(500).json({ message: result.message });
      }
    } catch (error) {
      console.error('이메일 인증 발송 오류:', error);
      res.status(500).json({ message: '서버 오류가 발생했습니다.' });
    }
  }

  // 이메일 인증번호 확인
  static async verifyCode(req, res) {
    try {
      const { email, code } = req.body;

      if (!email || !code) {
        return res
          .status(400)
          .json({ message: '이메일과 인증번호가 필요합니다.' });
      }

      // EmailVerificationController 사용
      const result = await EmailVerificationController.verifySignupCode(
        email,
        code
      );

      if (result.success) {
        return res.status(200).json({
          message: result.message,
          verified: result.verified,
        });
      } else {
        return res.status(400).json({
          message: result.message,
          verified: result.verified,
        });
      }
    } catch (error) {
      console.error('인증 코드 확인 중 오류:', error);
      res.status(500).json({ message: '서버 오류가 발생했습니다.' });
    }
  }

  // 이메일 인증 상태 확인
  static async checkEmailVerification(req, res) {
    try {
      const { email } = req.query;

      if (!email) {
        return res.status(400).json({ message: '이메일 주소가 필요합니다.' });
      }

      // EmailVerificationController 사용
      const result =
        await EmailVerificationController.checkSignupVerificationStatus(email);

      if (result.success) {
        return res.status(200).json({
          verified: result.verified,
        });
      } else {
        return res.status(400).json({
          message: result.message,
          verified: result.verified,
        });
      }
    } catch (error) {
      console.error('인증 상태 확인 중 오류:', error);
      res.status(500).json({ message: '서버 오류가 발생했습니다.' });
    }
  }
}

module.exports = SignupController;
