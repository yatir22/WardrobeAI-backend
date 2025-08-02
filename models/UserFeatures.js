const mongoose = require('mongoose');

const userFeatureSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true,
  },
  metadata: {
    type: Object,
    default: {},
  },
});

module.exports = mongoose.model('UserFeature', userFeatureSchema);
