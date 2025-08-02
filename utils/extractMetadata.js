const fetch = require('node-fetch');

const GEMINI_API_KEY = 'AIzaSyBkFybD5nCxSp4dh1g7y8BvNr9GyeqLnPI'; // Replace with your actual key

// Convert image URL to base64
async function imageToBase64(url) {
  const res = await fetch(url);
  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

// Main function to extract metadata
async function extractMetadataFromImage(imageUrl, category) {
  console.log('🧾 CATEGORY RECEIVED:', category);

  let prompt;

  // Set prompt dynamically based on category
  if (category === 'user') {
    prompt = `
You are a fashion assistant AI. Analyze the person in this image and return a JSON with the following keys:
{
  "gender": "e.g. male, female",
  "body_type": "e.g. slim, curvy, athletic, hourglass",
  "skin_tone": "e.g. fair, medium, dark",
  "hair": "e.g. black straight, brown curly",
  "face_shape": "e.g. round, oval, heart",
  "shoulder":   "e.g. broad,narrow",
  "height": "e.g. short, average, tall",
  "eye color": "e.g. grey,brown",
  "bust size":"e.g. big,small,medium",
  "waist size":"e.g. small, broad",
  "hip size":"e.g. huge, small",
  "leg length":"e.g. long, thick,skinny",
  "arm lenght":"e.g. short, fat ,skinny"
}
`;
  } else {
    prompt = `
You are a fashion expert AI. Given a clothing image, analyze and return a JSON with the following keys:
{
  "color": "string",
  "pattern": "string",
  "style": "string",
  "occasion": "string",
  "neckline":"string",
  "description": "short description"
}
`;
  }

  try {
    const base64Image = await imageToBase64(imageUrl);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Image,
                  },
                },
              ],
            },
          ],
        }),
      }
    );

    const json = await response.json();
   // console.log('📦 Full Gemini response:', JSON.stringify(json, null, 2));

    const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    //console.log('🧠 Gemini raw response:', rawText);

    const match = rawText?.match(/\{[\s\S]*\}/);
    const metadata = match ? JSON.parse(match[0]) : {};

    console.log('✅ Parsed metadata:', metadata);
    return metadata;
  } catch (err) {
    console.error('❌ Metadata extraction failed:', err.message);
    return {};
  }
}

module.exports = extractMetadataFromImage;
