// controllers/account/email_verification_controller.js
require('dotenv').config();
const nodemailer = require('nodemailer');
const accountDAO = require('../../models/accountDAO');

class EmailVerificationController {
  // nodemailer 설정
  static getTransporter() {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD,
      },
    });
  }

  // 인증 코드 생성 함수
  static generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // 이메일 발송 (회원가입용)
  static async sendSignupVerificationEmail(email) {
    try {
      const verificationCode = this.generateVerificationCode();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5분 후 만료

      console.log(`인증 코드 생성: ${email} - 코드: ${verificationCode}`);

      // 기존 인증 코드 확인 및 업데이트/생성
      const existingCode = await accountDAO.getVerificationCode(email);

      if (existingCode) {
        await accountDAO.updateVerificationCode(
          email,
          verificationCode,
          expiresAt
        );
        console.log(`기존 인증 코드 업데이트: ${email}`);
      } else {
        await accountDAO.createVerificationCode(
          email,
          verificationCode,
          expiresAt
        );
        console.log(`새 인증 코드 생성: ${email}`);
      }

      // 이메일 발송
      const transporter = this.getTransporter();
      const mailOptions = {
        from: `"회원가입 인증" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: '회원가입 이메일 인증 코드',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>이메일 인증 코드</h2>
            <p>안녕하세요!</p>
            <p>회원가입을 위한 인증 코드입니다:</p>
            <div style="background-color: #f0f0f0; padding: 15px; font-size: 24px; text-align: center; letter-spacing: 5px; font-weight: bold; border-radius: 4px; margin: 20px 0;">
              ${verificationCode}
            </div>
            <p>이 코드는 5분 후에 만료됩니다.</p>
            <p>이 이메일을 요청하지 않았다면 무시하셔도 됩니다.</p>
          </div>
        `,
      };

      await new Promise((resolve, reject) => {
        transporter.sendMail(mailOptions, (err, info) => {
          if (err) {
            console.error('이메일 발송 오류:', err);
            reject(err);
            return;
          }
          console.log('회원가입 인증 메일 발송 성공:', info.messageId);
          resolve(info);
        });
      });

      return {
        success: true,
        message: '인증번호가 이메일로 발송되었습니다.',
      };
    } catch (error) {
      console.error('이메일 인증 발송 오류:', error);
      return {
        success: false,
        message: '이메일 발송에 실패했습니다.',
      };
    }
  }

  // 인증 코드 확인 (회원가입용)
  static async verifySignupCode(email, code) {
    try {
      const verificationData = await accountDAO.getVerificationCode(email);

      if (!verificationData) {
        return {
          success: false,
          verified: false,
          message: '인증 정보를 찾을 수 없습니다.',
        };
      }

      // 만료 시간 확인
      if (new Date() > new Date(verificationData.expires_at)) {
        return {
          success: false,
          verified: false,
          message: '인증번호가 만료되었습니다. 다시 요청해주세요.',
        };
      }

      // 인증번호 확인
      if (verificationData.code !== code) {
        return {
          success: false,
          verified: false,
          message: '인증번호가 일치하지 않습니다.',
        };
      }

      // 인증 완료 처리
      await accountDAO.markEmailAsVerified(email);
      console.log(`이메일 인증 완료: ${email}`);

      return {
        success: true,
        verified: true,
        message: '이메일 인증이 완료되었습니다.',
      };
    } catch (error) {
      console.error('인증 코드 확인 중 오류:', error);
      return {
        success: false,
        verified: false,
        message: '서버 오류가 발생했습니다.',
      };
    }
  }

  // 인증 상태 확인 (회원가입용)
  static async checkSignupVerificationStatus(email) {
    try {
      const verificationData = await accountDAO.getVerificationCode(email);

      if (!verificationData) {
        return {
          success: false,
          verified: false,
          message: '인증 정보를 찾을 수 없습니다.',
        };
      }

      return {
        success: true,
        verified: verificationData.verified === 1,
      };
    } catch (error) {
      console.error('인증 상태 확인 중 오류:', error);
      return {
        success: false,
        verified: false,
        message: '서버 오류가 발생했습니다.',
      };
    }
  }

  // 비밀번호 재설정용 이메일 발송
  static async sendPasswordResetEmail(userId, email) {
    try {
      // 사용자 확인
      const user = await accountDAO.getUserByIdAndEmail(userId, email);
      if (!user) {
        return {
          success: false,
          message: '일치하는 회원 정보를 찾을 수 없습니다.',
        };
      }

      const verificationCode = this.generateVerificationCode();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5분 후 만료

      console.log(
        `비밀번호 재설정 코드 생성: ${email} - 코드: ${verificationCode}`
      );

      // 기존 인증 코드 확인 및 업데이트/생성
      const existingCode = await accountDAO.getVerificationCode(email);

      if (existingCode) {
        await accountDAO.updateVerificationCode(
          email,
          verificationCode,
          expiresAt
        );
        console.log(`기존 인증 코드 업데이트: ${email}`);
      } else {
        await accountDAO.createVerificationCode(
          email,
          verificationCode,
          expiresAt
        );
        console.log(`새 인증 코드 생성: ${email}`);
      }

      // 이메일 발송
      const transporter = this.getTransporter();
      const mailOptions = {
        from: `"비밀번호 재설정" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: '비밀번호 재설정 인증 코드',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>비밀번호 재설정 인증 코드</h2>
            <p>안녕하세요!</p>
            <p>비밀번호 재설정을 위한 인증 코드입니다:</p>
            <div style="background-color: #f0f0f0; padding: 15px; font-size: 24px; text-align: center; letter-spacing: 5px; font-weight: bold; border-radius: 4px; margin: 20px 0;">
              ${verificationCode}
            </div>
            <p>아이디: <strong>${userId}</strong></p>
            <p>이 코드는 5분 후에 만료됩니다.</p>
            <p>이 이메일을 요청하지 않았다면 무시하셔도 됩니다.</p>
          </div>
        `,
      };

      await new Promise((resolve, reject) => {
        transporter.sendMail(mailOptions, (err, info) => {
          if (err) {
            console.error('이메일 발송 오류:', err);
            reject(err);
            return;
          }
          console.log('비밀번호 재설정 메일 발송 성공:', info.messageId);
          resolve(info);
        });
      });

      return {
        success: true,
        message: '비밀번호 재설정 인증 코드가 이메일로 발송되었습니다.',
      };
    } catch (error) {
      console.error('비밀번호 재설정 이메일 발송 오류:', error);
      return {
        success: false,
        message: '이메일 발송에 실패했습니다.',
      };
    }
  }

  // 비밀번호 재설정용 인증 코드 확인
  static async verifyPasswordResetCode(userId, email, code) {
    try {
      // 사용자 확인
      const user = await accountDAO.getUserByIdAndEmail(userId, email);
      if (!user) {
        return {
          success: false,
          verified: false,
          message: '일치하는 회원 정보를 찾을 수 없습니다.',
        };
      }

      const verificationData = await accountDAO.getVerificationCode(email);

      if (!verificationData) {
        return {
          success: false,
          verified: false,
          message: '인증 정보를 찾을 수 없습니다.',
        };
      }

      // 만료 시간 확인
      if (new Date() > new Date(verificationData.expires_at)) {
        return {
          success: false,
          verified: false,
          message: '인증번호가 만료되었습니다. 다시 요청해주세요.',
        };
      }

      // 인증번호 확인
      if (verificationData.code !== code) {
        return {
          success: false,
          verified: false,
          message: '인증번호가 일치하지 않습니다.',
        };
      }

      // 인증 완료 처리
      await accountDAO.markEmailAsVerified(email);
      console.log(`비밀번호 재설정 인증 완료: ${email}`);

      return {
        success: true,
        verified: true,
        message: '인증이 완료되었습니다.',
      };
    } catch (error) {
      console.error('비밀번호 재설정 인증 확인 중 오류:', error);
      return {
        success: false,
        verified: false,
        message: '서버 오류가 발생했습니다.',
      };
    }
  }
}

module.exports = EmailVerificationController;
