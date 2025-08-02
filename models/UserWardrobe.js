const mongoose = require('mongoose');

const userWardrobeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'WardrobeUser', required: true, unique: true },
  clothes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Clothing' }],
  userFeatures: { type: Object, default: {} },
  userPhotoUrl: {type: String, default: ''     // Defaults to an empty string.
  }
});

module.exports = mongoose.model('UserWardrobe', userWardrobeSchema);
