const mongoose = require('mongoose');

const clothingSchema = new mongoose.Schema({
  category: {
    type: String,
    enum: ['top', 'bottom', 'dress'], // user_photos is NOT valid here
    required: true,
  },
  url: {
    type: String,
    required: true,
  },
  metadata: {
    type: Object,
    default: {},
  },
});

module.exports = mongoose.model('Clothing', clothingSchema);
