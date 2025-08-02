const express = require('express');
const multer = require('multer');
const cors = require('cors');
const mongoose = require('mongoose');
const { v2: cloudinary } = require('cloudinary');
const fs = require('fs');
const Clothing = require('./models/Clothing');
const UserFeature = require('./models/UserFeatures');
const WardrobeUser = require('./models/WardrobeUser');
const UserWardrobe = require('./models/UserWardrobe');
const extractMetadataFromGemini = require('./utils/extractMetadata');
const extractMetadataFromImage = require('./utils/extractMetadata');
const fetch = require('node-fetch');
const { authenticateToken, generateToken } = require('./middleware/auth');
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

// --- User-specific Clothing Upload Route ---
app.post('/upload', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    const category = req.query.category;
    const userId = req.user.userId; // Get userId from JWT token
    const filePath = req.file.path;
    
    if (!['top', 'bottom', 'dress'].includes(category)) {
      return res.status(400).json({ error: '❌ Invalid clothing category' });
    }
    const result = await cloudinary.uploader.upload(filePath, {
      folder: `wardrobe/${userId}/${category}`,
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
    // Add clothing to user's wardrobe
    let wardrobe = await UserWardrobe.findOne({ userId });
    if (!wardrobe) {
      wardrobe = new UserWardrobe({ userId, clothes: [clothingItem._id] });
    } else {
      wardrobe.clothes.push(clothingItem._id);
    }
    await wardrobe.save();
    res.json({ secure_url: result.secure_url, metadata });
  } catch (err) {
    console.error('❌ Upload error:', err);
    res.status(500).json({ error: '❌ Server error during upload' });
  }
});

// --- User-specific User Image Upload ---
app.post('/upload-user-image', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    const userId = req.user.userId; // Get userId from JWT token
    const filePath = req.file.path;
    const result = await cloudinary.uploader.upload(filePath, {
      folder: `wardrobe/${userId}/user_photos`,
    });
    fs.unlinkSync(filePath);
    if (!result.secure_url) {
      return res.status(500).json({ error: '❌ No image URL returned from Cloudinary' });
    }
    const newMetadata = await extractMetadataFromGemini(result.secure_url, 'user');
    let wardrobe = await UserWardrobe.findOne({ userId });
    if (!wardrobe) {
      wardrobe = new UserWardrobe({ userId, userFeatures: newMetadata,userPhotoUrl:result.secure_url });
    } else {
      // Merge newMetadata into existing userFeatures, appending as comma-separated values
      if (!wardrobe.userFeatures) {
        wardrobe.userFeatures = {};
      }
      for (const key in newMetadata) {
       // console.log("Key: ",key);
        if (newMetadata[key]) {
          if (wardrobe.userFeatures[key]) {
            wardrobe.userFeatures[key] += ', ' + newMetadata[key];
          } else {
            wardrobe.userFeatures[key] = newMetadata[key];
          }
        }
      }
      wardrobe.userPhotoUrl = result.secure_url;
    }
     wardrobe.markModified('userFeatures');
    await wardrobe.save();
    res.json({ urls: [result.secure_url], metadata: wardrobe.userFeatures });
  } catch (err) {
    console.error('❌ Upload error:', err);
    res.status(500).json({ error: '❌ Server error during upload' });
  }
});

// --- User-specific Outfit fetch route ---
app.get('/outfits', authenticateToken, async (req, res) => {
  const userId = req.user.userId; // Get userId from JWT token
  const category = req.query.folder;
  if (!category) {
    return res.status(400).json({ error: 'Folder (category) is required' });
  }
  try {
    // Only fetch clothes for this user and category
    const wardrobe = await UserWardrobe.findOne({ userId }).populate({
      path: 'clothes',
      match: { category },
    });
    const urls = (wardrobe && wardrobe.clothes) ? wardrobe.clothes.map(item => item.url) : [];
    res.json({ urls });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user outfits' });
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
// Get user features for a specific user
app.get('/user-features', authenticateToken, async (req, res) => {
  const userId = req.user.userId; // Get userId from JWT token
  try {
    const wardrobe = await UserWardrobe.findOne({ userId });
    if (!wardrobe || !wardrobe.userFeatures || Object.keys(wardrobe.userFeatures).length === 0) {
      return res.status(404).json({ error: 'No user features found. Please upload your photo first.' });
    }
    res.json(wardrobe.userFeatures);
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
app.post('/suggest-outfit', authenticateToken, async (req, res) => {
  const userId = req.user.userId; // Get userId from JWT token
  try {
    // Fetch user features and clothes for this user
    const wardrobe = await UserWardrobe.findOne({ userId }).populate('clothes');
    if (!wardrobe || !wardrobe.userFeatures || !wardrobe.clothes || wardrobe.clothes.length === 0) {
      return res.status(404).json({ error: 'No user features or clothes found for this user.' });
    }
    const userFeatures = wardrobe.userFeatures;
    const clothesMeta = wardrobe.clothes.map(item => ({
      _id: item._id,
      url: item.url,
      category: item.category,
      metadata: item.metadata
    }));

    let prompt = `User features: ${JSON.stringify(userFeatures)}\nClothes options:`;
    clothesMeta.forEach((item, idx) => {
      prompt += `\nOption ${idx + 1}: ${JSON.stringify(item.metadata)}`;
    });
    prompt += `\nAnalyze the user's features including body_type,waist,hip,chest size. shoulder broadness, complexion, face shape, hair and eye color and the clothes options. Determine the best outfit option for the user. Respond with ONLY a valid JSON object in the following format, and do not include any other text, markdown, or code block specifiers like \`\`\`json:\n{\n  \"optionNumber\": <the number of the best option>,\n  \"reason\": \"<A short, complimentary sentence explaining why this option suits the user, mentioning a specific feature like their skin tone or body type. dont make it harsh. Make it polite in a way user feels confidnet wearing>\"\n}`;

    const fetch = require('node-fetch');
    const GEMINI_API_KEY = 'AIzaSyBkFybD5nCxSp4dh1g7y8BvNr9GyeqLnPI';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        }),
      }
    );
    const json = await response.json();
    const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error('Received empty response from Gemini.');
    const cleanedText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    const aiResponse = JSON.parse(cleanedText);
    const { optionNumber, reason } = aiResponse;
    if (!optionNumber || optionNumber < 1 || optionNumber > clothesMeta.length) {
      throw new Error('Invalid option number from AI');
    }
    const selectedCloth = clothesMeta[optionNumber - 1];
    res.json({
      suggestedClothUrl: selectedCloth.url,
      reason: reason
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to suggest outfit', details: err.message });
  }
});

// --- User Registration ---
// --- User Registration ---
app.post('/create', async (req, res) => {
  try {
    // FIXED: Get `name` and `username` from the request body.
    const { name, email, username, password } = req.body;

    // VALIDATION: Check if the required fields were sent from the form.
    if (!name || !email || !username || !password) {
      return res.status(400).json({ error: 'Name, email, username, and password are all required.' });
    }

    // Check if email or username already exists (This logic is unchanged).
    const existing = await WardrobeUser.findOne({ $or: [ { email }, { username } ] });
    if (existing) {
      return res.status(409).json({ error: 'Email or username already registered.' });
    }

    // FIXED: Save the user with all the correct details, including `name`.
    const user = new WardrobeUser({ name, email, username, password });
    await user.save();

    // The success response now includes all user info.
    res.json({ 
      message: 'Account created successfully', 
      user: { 
        _id: user._id, 
        name: user.name, 
        email: user.email, 
        username: user.username, 
        createdAt: user.createdAt 
      } 
    });

  } catch (err) {
    // The catch block is unchanged but will now report errors more clearly.
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// --- User Login ---
app.post('/login', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    if (!email && !username) {
      return res.status(400).json({ error: 'Email or username required.' });
    }
    const user = await WardrobeUser.findOne(email ? { email } : { username });
    if (!user) {
      return res.status(404).json({ error: 'Email/username not registered.' });
    }
    if (user.password !== password) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }
    
    // Generate JWT token
    const token = generateToken(user._id);
    res.json({ 
      message: 'Login successful',
      token: token,
      user: { 
        _id: user._id, 
        name: user.name,
        email: user.email, 
        username: user.username, 
        createdAt: user.createdAt 
      } 
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

app.get('/check-username', async (req, res) => 
{
  const { username, email } = req.query;

  // 1. Determine the base username from email if needed
  if (!username && !email) {
    return res.status(400).json({ available: false, suggestions: [] });
  }

  let base = username;
  // If the provided username is too short or missing, use the email prefix
  if ((!base || base.length < 3) && email && email.includes('@')) {
    // Sanitize the email prefix to only include valid characters
    base = email.split('@')[0].replace(/[^a-zA-Z0-9_.]/g, '').toLowerCase();
  }

  if (!base) {
    return res.status(400).json({ available: false, suggestions: [] });
  }

  // 2. Check if the base username itself is available
  const baseExists = await WardrobeUser.findOne({ username: base });
  if (!baseExists) {
    return res.json({ available: true, suggestions: [] });
  }

  // 3. Generate a BATCH of random suggestions (if base is taken)
  const potentialUsernames = new Set(); // Use a Set to automatically avoid duplicates
  const randomWords = ['genAI', 'User', 'Stylist', 'Fashionista']; // Add more as you like

  while (potentialUsernames.size < 15) { // Generate a pool of 15 candidates
    // Suggestion type 1: Add random numbers (e.g., user123)
    const randomNumber = Math.floor(Math.random() * 900) + 100; // 3-digit number
    potentialUsernames.add(`${base}${randomNumber}`);

    // Suggestion type 2: Add random numbers with an underscore (e.g., user_78)
    const randomShortNumber = Math.floor(Math.random() * 90) + 10; // 2-digit number
    potentialUsernames.add(`${base}_${randomShortNumber}`);

    // Suggestion type 3: Add a random word (e.g., userPro)
    const randomWord = randomWords[Math.floor(Math.random() * randomWords.length)];
    potentialUsernames.add(`${base}${randomWord}`);
  }

  // 4. Use ONE efficient database query to find all taken usernames from our list
  const takenUsers = await WardrobeUser.find({ 
    username: { $in: [...potentialUsernames] } 
  });
  
  // Create a Set of the usernames that are already in the database for fast checking
  const takenUsernames = new Set(takenUsers.map(user => user.username));

  // 5. Filter our potential list to find the ones that are NOT taken
  const suggestions = [];
  for (const potential of potentialUsernames) {
    if (!takenUsernames.has(potential)) {
      suggestions.push(potential);
    }
    // Stop once we have 5 suggestions to show the user
    if (suggestions.length >= 5) {
      break;
    }
  }

  return res.json({ available: false, suggestions });
});


app.get('/user-photos', authenticateToken, async (req, res) => {
  try {
    // Get userId from JWT token
    const userId = req.user.userId;

    // Find the user's wardrobe document in the database using their userId.
    const wardrobe = await UserWardrobe.findOne({ userId });
    
    if (!wardrobe || !wardrobe.userPhotoUrl) {
      return res.json({ url: [] });
    }
    //console.log(wardrobe.userPhotoUrl );
    // 5. If photos are found, return them in the expected format.
    res.json({ url: wardrobe.userPhotoUrl });

  } catch (err) {
    // 6. Handle any unexpected server errors.
    res.status(500).json({ error: 'Failed to fetch user photos.' });
  }
});
app.get('/me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId; // from JWT
    const user = await WardrobeUser.findById(userId).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});
