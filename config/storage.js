const { Storage } = require('@google-cloud/storage');
const path = require('path');

// Google Cloud Storage 클라이언트 생성
const storage = new Storage({
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
  keyFilename: path.join(__dirname, '..', process.env.GOOGLE_CLOUD_KEYFILE),
});

const bucket = storage.bucket(process.env.GOOGLE_CLOUD_BUCKET_NAME);

module.exports = { storage, bucket };