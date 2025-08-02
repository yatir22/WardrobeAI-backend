const mongoose = require('mongoose');

const userImageSchema = new mongoose.Schema({
  url: { type: String, required: true },
  metadata: {
    body_type: String,
    skin_tone: String,
    gender: String,
    hair: String,
    face_shape: String
  },
});

module.exports = mongoose.model('UserImage', userImageSchema);
