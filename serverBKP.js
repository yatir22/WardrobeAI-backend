const express = require('express');
const multer = require('multer');
const cors = require('cors');
const mongoose = require('mongoose');
const { v2: cloudinary } = require('cloudinary');
const fs = require('fs');
const Clothing = require('./models/Clothing');
const UserFeature = require('./models/UserFeatures');
const extractMetadataFromGemini = require('./utils/extractMetadata');
const extractMetadataFromImage = require('./utils/extractMetadata');
const fetch = require('node-fetch');
const app = express();
const port = 5000;
const FormData = require('form-data');
app.use(cors());
app.use(express.json());
const axios = require('axios');
const upload = multer({ dest: 'uploads/' });

cloudinary.config({
  cloud_name: 'dne19j6gx',
  api_key: '628235666654258',
  api_secret: 'k5Lh8Gv8JRbh77-iw_Ew4gtOAk4',
});

mongoose.connect('mongodb+srv://yatirastogi:z3oHwdz93k6OPeQ2@cluster0.atxgff3.mongodb.net/wardrobe', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// ✅ Clothing Upload Route
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    const category = req.query.category;
    const filePath = req.file.path;

    if (!['top', 'bottom', 'dress'].includes(category)) {
      return res.status(400).json({ error: '❌ Invalid clothing category' });
    }

    const result = await cloudinary.uploader.upload(filePath, {
      folder: `wardrobe/${category}`,
    });

    fs.unlinkSync(filePath);

    if (!result.secure_url) {
      return res.status(500).json({ error: '❌ No image URL returned from Cloudinary' });
    }

    const metadata = await extractMetadataFromGemini(result.secure_url, category);

    const clothingItem = new Clothing({
      category,
      url: result.secure_url,
      metadata,
    });

    await clothingItem.save();

    res.json({
      secure_url: result.secure_url,
      metadata,
    });

  } catch (err) {
    console.error('❌ Upload error:', err);
    res.status(500).json({ error: '❌ Server error during upload' });
  }
});

// ✅ User Image Upload — merges metadata into a single entry
app.post('/upload-user-image', upload.single('image'), async (req, res) => {
  try {
    const filePath = req.file.path;

    const result = await cloudinary.uploader.upload(filePath, {
      folder: 'wardrobe/user_photos',
    });

    fs.unlinkSync(filePath);

    if (!result.secure_url) {
      return res.status(500).json({ error: '❌ No image URL returned from Cloudinary' });
    }

    const newMetadata = await extractMetadataFromGemini(result.secure_url, 'user');

    let userFeature = await UserFeature.findOne();

    if (userFeature) {
      const updatedMetadata = { ...userFeature.metadata };

      for (const key in newMetadata) {
        if (newMetadata[key]) {
          if (updatedMetadata[key]) {
            updatedMetadata[key] += `, ${newMetadata[key]}`;
          } else {
            updatedMetadata[key] = newMetadata[key];
          }
        }
      }

      userFeature.url = result.secure_url;
      userFeature.metadata = updatedMetadata;
      await userFeature.save();
    } else {
      userFeature = new UserFeature({
        url: result.secure_url,
        metadata: newMetadata,
      });
      await userFeature.save();
    }

    res.json({
      urls: [result.secure_url],
      metadata: userFeature.metadata,
    });

  } catch (err) {
    console.error('❌ Upload error:', err);
    res.status(500).json({ error: '❌ Server error during upload' });
  }
});

// ✅ Outfit fetch route - needed for OutfitSelector
app.get('/outfits', async (req, res) => {
  const folder = req.query.folder;
  if (!folder) {
    return res.status(400).json({ error: 'Folder query parameter is required' });
  }

  try {
    const { resources } = await cloudinary.search
      .expression(`folder:wardrobe/${folder}`)
      .sort_by('created_at', 'desc')
      .max_results(30)
      .execute();

    const urls = resources.map(file => file.secure_url);
    res.json({ urls });

  } catch (err) {
    console.error('❌ Cloudinary fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch images from Cloudinary' });
  }
});

/// ✅ Try-On Diffusion using URL-based endpoint
app.post('/tryon', async (req, res) => {
  const { userImageUrl, clothImageUrl } = req.body;

  if (!userImageUrl || !clothImageUrl) {
    return res.status(400).json({ error: '❌ Image URLs are required' });
  }

  try {
    // Construct form body as URLSearchParams
    const encodedParams = new URLSearchParams();
    encodedParams.append('avatar_image_url', userImageUrl);
    encodedParams.append('clothing_image_url', clothImageUrl);

    // Optional: You can also pass avatar_sex, prompts, etc. like:
    // encodedParams.append('avatar_sex', 'female');

    const response = await axios({
      method: 'POST',
      url: 'https://try-on-diffusion.p.rapidapi.com/try-on-url',
      headers: {
        'x-rapidapi-key': '770ba67791msh589ea1dfcae76b7p19c9f8jsn326fccf6f02a',
        'x-rapidapi-host': 'try-on-diffusion.p.rapidapi.com',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: encodedParams,
      responseType: 'arraybuffer', // Important: tells axios to treat response as binary
    });

    const base64Image = Buffer.from(response.data).toString('base64');
    const contentType = response.headers['content-type'] || 'image/jpeg';
    const dataUrl = `data:${contentType};base64,${base64Image}`;

    res.json({ previewUrl: dataUrl });
  } catch (error) {
    console.error('❌ Try-On error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Try-On failed',
      details: error.response?.data || error.message,
    });
  }
});

// ✅ Get all user features (metadata)
app.get('/user-features', async (req, res) => {
  try {
    const userFeature = await UserFeature.findOne();
    if (!userFeature) return res.status(404).json({ error: 'No user features found' });
    res.json(userFeature);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user features' });
  }
});

// ✅ Get all clothes metadata
app.get('/clothes-metadata', async (req, res) => {
  try {
    const clothes = await Clothing.find();
    res.json(clothes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch clothes metadata' });
  }
});
// ✅ Suggest outfit using AI (Gemini or similar)
app.post('/suggest-outfit', async (req, res) => {
  const { userMeta, clothesMeta } = req.body;
  try {
    let prompt = `User features: ${JSON.stringify(userMeta.metadata)}\nClothes options:`;
    clothesMeta.forEach((item, idx) => {
      prompt += `\nOption ${idx + 1}: ${JSON.stringify(item.metadata)}`;
    });
    prompt += `\nAnalyze the user's features including body_type,waist,hip,chest size. shoulder broadness, complexion, face shape, hair and eye color and the clothes options. Determine the best outfit option for the user. Respond with ONLY a valid JSON object in the following format, and do not include any other text, markdown, or code block specifiers like \`\`\`json:\n{\n  \"optionNumber\": <the number of the best option>,\n  \"reason\": \"<A short, complimentary sentence explaining why this option suits the user, mentioning a specific feature like their skin tone or body type. dont make it harsh. Make it polite in a way user feels confidnet wearing>\"\n}`;
   
    const fetch = require('node-fetch');
    const GEMINI_API_KEY = 'AIzaSyBkFybD5nCxSp4dh1g7y8BvNr9GyeqLnPI';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        }),
      }
    );
    const json = await response.json();
     console.log(json);
    const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error('Received empty response from Gemini.');
    const cleanedText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    console.log(cleanedText);
    const aiResponse = JSON.parse(cleanedText);
    const { optionNumber, reason } = aiResponse;
    if (!optionNumber || optionNumber < 1 || optionNumber > clothesMeta.length) {
      throw new Error('Invalid option number from AI');
    }
    const selectedCloth = clothesMeta[optionNumber - 1];
    const Clothing = require('./models/Clothing');
    const clothingDoc = await Clothing.findById(selectedCloth._id);
    if (!clothingDoc) throw new Error('Clothing item not found in DB');
    res.json({
      suggestedClothUrl: clothingDoc.url,
      reason: reason
    });
  } catch (err) {
    console.error('Suggest outfit error:', err);
    res.status(500).json({ error: 'Failed to suggest outfit', details: err.message });
  }
});


app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});
