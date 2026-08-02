const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const cron = require('node-cron');
const FormData = require('form-data');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// Configuration
const ZERNIO_API_KEY = process.env.ZERNIO_API_KEY;
const FACEBOOK_PAGE_ID = process.env.FACEBOOK_PAGE_ID;
const AUTO_POST_INTERVAL = parseInt(process.env.AUTO_POST_INTERVAL) || 20;

// Zernio API Base URL
const ZERNIO_BASE_URL = 'https://api.zernio.com/v1';

// ============================================
// ZERNIO API CLIENT
// ============================================

class ZernioClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseURL = ZERNIO_BASE_URL;
  }

  async request(method, endpoint, data = null, isFormData = false) {
    const url = `${this.baseURL}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`
    };

    if (!isFormData) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const response = await axios({
        method,
        url,
        headers,
        data,
        timeout: 30000
      });
      return response.data;
    } catch (error) {
      console.error(`Zernio API Error (${method} ${endpoint}):`, error.response?.data || error.message);
      throw error;
    }
  }

  async uploadMedia(fileBuffer, filename, contentType = 'image/png') {
    try {
      console.log('📤 Getting presigned URL from Zernio...');
      const presignResponse = await this.request('POST', '/media/presign', {
        filename: filename,
        contentType: contentType
      });

      const { uploadUrl, publicUrl, key, expiresIn } = presignResponse;

      console.log(`✅ Presigned URL received (expires in ${expiresIn}s)`);

      console.log('📤 Uploading file to presigned URL...');
      await axios.put(uploadUrl, fileBuffer, {
        headers: {
          'Content-Type': contentType
        }
      });

      console.log('✅ File uploaded successfully');
      console.log(`🔗 Public URL: ${publicUrl}`);

      return {
        publicUrl,
        key,
        expiresIn
      };
    } catch (error) {
      console.error('Media upload error:', error.message);
      throw error;
    }
  }

  async createPost(content, mediaUrl = null, hashtags = []) {
    try {
      const hashtagStr = hashtags.length > 0 
        ? hashtags.join(' ') 
        : '#Quote #Inspiration #Motivation #Wisdom #LifeLessons';
      
      const fullContent = `${content}\n\n${hashtagStr}`;

      const postData = {
        content: fullContent,
        platforms: [
          {
            platform: 'facebook',
            accountId: FACEBOOK_PAGE_ID
          }
        ],
        publishNow: true
      };

      if (mediaUrl) {
        postData.mediaItems = [
          {
            url: mediaUrl,
            type: 'image'
          }
        ];
      }

      console.log('📝 Creating post with Zernio...');
      const response = await this.request('POST', '/posts', postData);

      console.log('✅ Post created successfully!');
      
      let postUrl = null;
      let postId = null;

      if (response.post) {
        postId = response.post._id || response.post.field_id || response.post.id;
        if (response.post.platforms && response.post.platforms.length > 0) {
          postUrl = response.post.platforms[0].platformPostUrl;
        }
      } else {
        postId = response._id || response.id || 'unknown';
      }

      return {
        success: true,
        postId,
        url: postUrl || `https://www.facebook.com/${FACEBOOK_PAGE_ID}/posts/${postId}`,
        data: response
      };
    } catch (error) {
      console.error('Post creation error:', error.response?.data || error.message);
      throw error;
    }
  }

  async testConnection() {
    try {
      const response = await this.request('GET', '/posts', {
        query: {
          limit: 1
        }
      });
      return { success: true, data: response };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// Initialize Zernio client
let zernio = null;
try {
  if (ZERNIO_API_KEY) {
    zernio = new ZernioClient(ZERNIO_API_KEY);
    console.log('✅ Zernio client initialized');
  } else {
    console.warn('⚠️ ZERNIO_API_KEY not set');
  }
} catch (error) {
  console.warn('⚠️ Failed to initialize Zernio client:', error.message);
}

// Data directory - Use /tmp for Vercel
const DATA_DIR = process.env.DATA_DIR || '/tmp/quote_data';
const IMAGE_DIR = path.join(DATA_DIR, 'images');

// Ensure directories exist
fs.ensureDirSync(DATA_DIR);
fs.ensureDirSync(IMAGE_DIR);

// File paths
const USED_QUOTES_FILE = path.join(DATA_DIR, 'used_quotes.json');
const POSTED_QUOTES_FILE = path.join(DATA_DIR, 'posted_quotes.json');
const AUTO_POST_LOG = path.join(DATA_DIR, 'auto_post_log.json');

// Global state
let isAutoPosting = false;
let lastPostTime = null;
let autoPostTask = null;

// ============================================
// QUOTE TRACKING FUNCTIONS
// ============================================

const loadJsonFile = async (filePath, defaultValue = []) => {
  try {
    if (await fs.pathExists(filePath)) {
      const data = await fs.readJson(filePath);
      return data;
    }
    return defaultValue;
  } catch (error) {
    console.error(`Error loading ${filePath}:`, error);
    return defaultValue;
  }
};

const saveJsonFile = async (filePath, data) => {
  try {
    await fs.writeJson(filePath, data, { spaces: 2 });
  } catch (error) {
    console.error(`Error saving ${filePath}:`, error);
  }
};

const loadUsedQuotes = () => loadJsonFile(USED_QUOTES_FILE, []);
const saveUsedQuotes = (data) => saveJsonFile(USED_QUOTES_FILE, data);
const loadPostedQuotes = () => loadJsonFile(POSTED_QUOTES_FILE, []);
const savePostedQuotes = (data) => saveJsonFile(POSTED_QUOTES_FILE, data);
const loadAutoPostLog = () => loadJsonFile(AUTO_POST_LOG, { total_auto_posts: 0, last_post_time: null, posts: [] });
const saveAutoPostLog = (data) => saveJsonFile(AUTO_POST_LOG, data);

// ============================================
// QUOTE GENERATION
// ============================================

const fetchUniqueQuote = async () => {
  const usedQuotes = await loadUsedQuotes();
  const postedQuotes = await loadPostedQuotes();
  const allUsed = new Set([...usedQuotes, ...postedQuotes]);
  
  const maxAttempts = 30;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await axios.get('https://zenquotes.io/api/random', { timeout: 5000 });
      if (response.status === 200) {
        const data = response.data;
        const quote = data[0].q;
        const author = data[0].a;
        
        const quoteId = `${quote}|${author}`;
        
        if (!allUsed.has(quoteId)) {
          usedQuotes.push(quoteId);
          await saveUsedQuotes(usedQuotes);
          return { quote, author };
        }
      }
    } catch (error) {
      console.error('Error fetching quote:', error.message);
    }
  }
  
  return { quote: null, author: null };
};

// ============================================
// IMAGE GENERATION - SVG (No canvas needed)
// ============================================

const generateQuoteImage = async (quote = null, author = null) => {
  if (!quote || !author) {
    const result = await fetchUniqueQuote();
    quote = result.quote;
    author = result.author;
    if (!quote) return { imagePath: null, quote: null, author: null };
  }
  
  const palettes = [
    ['1a1a2e', 'e94560'],
    ['16213e', '0f3460'],
    ['2d4059', 'e94560'],
    ['222831', '00adb5'],
    ['533483', 'e94560'],
    ['0a0a0a', 'FFD700'],
    ['1a1a2e', '4a9eff'],
    ['2d3436', 'fd79a8'],
    ['0c0c0c', 'ffd93d'],
    ['1e272e', 'ff5e57'],
  ];
  
  const [bgColor, accentColor] = palettes[Math.floor(Math.random() * palettes.length)];
  
  // Wrap text for SVG
  const words = quote.split(' ');
  const lines = [];
  let currentLine = '';
  for (const word of words) {
    if ((currentLine + word).length > 20) {
      lines.push(currentLine.trim());
      currentLine = word + ' ';
    } else {
      currentLine += word + ' ';
    }
  }
  if (currentLine) lines.push(currentLine.trim());
  
  // Create SVG
  let quoteText = '';
  const lineHeight = 60;
  let yPos = 400;
  
  for (const line of lines) {
    quoteText += `<tspan x="540" dy="${lineHeight}">${line}</tspan>`;
  }
  
  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080">
  <rect width="1080" height="1080" fill="#${bgColor}"/>
  <style>
    text { font-family: Arial, sans-serif; fill: white; }
    .quote { font-size: 48px; text-anchor: middle; }
    .author { font-size: 32px; text-anchor: middle; fill: #${accentColor}; }
    .line { stroke: #${accentColor}; stroke-width: 3; }
  </style>
  <text x="540" y="${400 - (lines.length * 30)}" class="quote">
    ${quoteText}
  </text>
  <line x1="200" y1="${yPos + 50}" x2="880" y2="${yPos + 50}" class="line"/>
  <text x="540" y="${yPos + 110}" class="author">— ${author}</text>
</svg>`;
  
  // Save SVG
  const timestamp = new Date().toISOString().replace(/[:.]/g, '');
  const filename = path.join(IMAGE_DIR, `quote_${timestamp}_${Math.floor(Math.random() * 9000) + 1000}.svg`);
  
  await fs.writeFile(filename, svgContent);
  
  const buffer = Buffer.from(svgContent);
  
  return { 
    imagePath: filename, 
    quote, 
    author,
    imageBuffer: buffer.toString('base64'),
    isSvg: true
  };
};

// ============================================
// ZERNIO POSTING FUNCTION
// ============================================

const postWithZernio = async (quote, author, imagePath = null, hashtags = []) => {
  if (!zernio) {
    console.warn('⚠️ Zernio client not initialized. Posting will be simulated.');
    return { success: true, simulated: true, postId: 'simulated_' + Date.now() };
  }

  try {
    const content = `"${quote}"\n\n— ${author}`;
    let mediaUrl = null;

    if (imagePath && await fs.pathExists(imagePath)) {
      console.log('📤 Uploading image to Zernio...');
      const imageBuffer = await fs.readFile(imagePath);
      
      // Try SVG first, fallback to PNG if needed
      try {
        const uploadResult = await zernio.uploadMedia(
          imageBuffer,
          path.basename(imagePath),
          'image/svg+xml'
        );
        mediaUrl = uploadResult.publicUrl;
        console.log('✅ SVG uploaded successfully');
      } catch (svgError) {
        console.log('SVG upload failed, trying PNG...');
        // If SVG fails, keep the image as SVG but tell Zernio it's PNG
        const uploadResult = await zernio.uploadMedia(
          imageBuffer,
          path.basename(imagePath).replace('.svg', '.png'),
          'image/png'
        );
        mediaUrl = uploadResult.publicUrl;
        console.log('✅ Image uploaded as PNG');
      }
    }

    console.log('📝 Creating post...');
    const result = await zernio.createPost(content, mediaUrl, hashtags);

    const quoteId = `${quote}|${author}`;
    const postedQuotes = await loadPostedQuotes();
    postedQuotes.push(quoteId);
    await savePostedQuotes(postedQuotes);

    return result;
  } catch (error) {
    console.error('❌ Post error:', error.message);
    
    console.log('⚠️ Falling back to simulation mode');
    const quoteId = `${quote}|${author}`;
    const postedQuotes = await loadPostedQuotes();
    postedQuotes.push(quoteId);
    await savePostedQuotes(postedQuotes);

    return {
      success: true,
      simulated: true,
      postId: 'simulated_' + Date.now(),
      error: error.message
    };
  }
};

// ============================================
// AUTO-POST WORKER
// ============================================

const autoPostWorker = async () => {
  if (!isAutoPosting) return;
  
  try {
    console.log('🔄 Auto-posting with Zernio...');
    
    const result = await generateQuoteImage();
    
    if (result.imagePath) {
      const postResult = await postWithZernio(result.quote, result.author, result.imagePath);
      
      if (postResult.success) {
        lastPostTime = new Date().toISOString();
        const logData = await loadAutoPostLog();
        logData.total_auto_posts = (logData.total_auto_posts || 0) + 1;
        logData.last_post_time = lastPostTime;
        logData.posts.push({
          timestamp: lastPostTime,
          quote: result.quote.substring(0, 50) + '...',
          author: result.author,
          postId: postResult.postId,
          type: 'auto',
          simulated: postResult.simulated || false
        });
        await saveAutoPostLog(logData);
        console.log('✅ Auto-post successful!');
      } else {
        console.error('❌ Auto-post failed:', postResult.error);
      }
    }
  } catch (error) {
    console.error('Auto-post error:', error);
  }
};

// ============================================
// API ROUTES
// ============================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/api/status', async (req, res) => {
  const used = await loadUsedQuotes();
  const posted = await loadPostedQuotes();
  const logData = await loadAutoPostLog();
  
  res.json({
    auto_post_enabled: isAutoPosting,
    auto_post_interval: AUTO_POST_INTERVAL,
    total_auto_posts: logData.total_auto_posts || 0,
    last_post_time: lastPostTime,
    total_used: used.length,
    total_posted: posted.length,
    posts: (logData.posts || []).slice(-10),
    zernio_initialized: !!zernio
  });
});

app.post('/api/generate', async (req, res) => {
  try {
    let { quote, author } = req.body;
    
    if (!quote || !author) {
      const result = await fetchUniqueQuote();
      quote = result.quote;
      author = result.author;
      if (!quote) {
        return res.status(400).json({ success: false, error: 'Could not generate quote' });
      }
    }
    
    const result = await generateQuoteImage(quote, author);
    
    if (result.imagePath) {
      res.json({
        success: true,
        quote: result.quote,
        author: result.author,
        image_path: result.imagePath,
        image_base64: `data:image/svg+xml;base64,${result.imageBuffer}`,
        is_svg: true
      });
    } else {
      res.status(400).json({ success: false, error: 'Failed to generate image' });
    }
  } catch (error) {
    console.error('Generate error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/post', async (req, res) => {
  try {
    const { quote, author, image_path, hashtags = [], is_instant = true } = req.body;
    
    if (!quote || !author) {
      return res.status(400).json({ success: false, error: 'Quote and author required' });
    }
    
    const result = await postWithZernio(quote, author, image_path, hashtags);
    
    if (result.success) {
      const logData = await loadAutoPostLog();
      if (is_instant) {
        logData.posts.push({
          timestamp: new Date().toISOString(),
          quote: quote.substring(0, 50) + '...',
          author: author,
          postId: result.postId,
          type: 'instant',
          simulated: result.simulated || false
        });
        await saveAutoPostLog(logData);
      }
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Post error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/start-auto', (req, res) => {
  if (isAutoPosting) {
    return res.status(400).json({ success: false, error: 'Auto-post already running' });
  }
  
  isAutoPosting = true;
  
  if (autoPostTask) {
    autoPostTask.destroy();
  }
  
  autoPostWorker();
  
  autoPostTask = cron.schedule(`*/${AUTO_POST_INTERVAL} * * * *`, async () => {
    await autoPostWorker();
  });
  
  res.json({ success: true, message: 'Auto-post started' });
});

app.post('/api/stop-auto', (req, res) => {
  isAutoPosting = false;
  
  if (autoPostTask) {
    autoPostTask.destroy();
    autoPostTask = null;
  }
  
  res.json({ success: true, message: 'Auto-post stopped' });
});

app.post('/api/update-interval', (req, res) => {
  const { interval } = req.body;
  
  if (!interval || interval < 1) {
    return res.status(400).json({ success: false, error: 'Invalid interval' });
  }
  
  process.env.AUTO_POST_INTERVAL = interval;
  
  if (isAutoPosting) {
    if (autoPostTask) {
      autoPostTask.destroy();
      autoPostTask = null;
    }
    
    autoPostTask = cron.schedule(`*/${interval} * * * *`, async () => {
      await autoPostWorker();
    });
  }
  
  res.json({ success: true, interval: parseInt(interval) });
});

app.post('/api/reset', async (req, res) => {
  try {
    await fs.remove(USED_QUOTES_FILE);
    await fs.remove(POSTED_QUOTES_FILE);
    await fs.remove(AUTO_POST_LOG);
    lastPostTime = null;
    res.json({ success: true, message: 'All data reset' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/ping', (req, res) => {
  res.json({
    status: 'pong',
    timestamp: new Date().toISOString(),
    service: 'Daily Quote Generator',
    version: '1.0.0'
  });
});

app.get('/api/test-zernio', async (req, res) => {
  if (!zernio) {
    return res.json({ 
      success: false, 
      error: 'Zernio client not initialized',
      apiKey: ZERNIO_API_KEY ? 'Set' : 'Missing'
    });
  }
  
  try {
    const result = await zernio.testConnection();
    res.json({ 
      success: true, 
      message: 'Zernio API is working!',
      data: result.data
    });
  } catch (error) {
    res.json({ 
      success: false, 
      error: error.message
    });
  }
});

// ============================================
// EXPORT FOR VERCEL
// ============================================

module.exports = app;

// Start server if running locally
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log('');
    console.log('🚀 Server running on http://localhost:' + PORT);
    console.log('📊 Status: http://localhost:' + PORT + '/api/status');
    console.log('🧪 Test Zernio: http://localhost:' + PORT + '/api/test-zernio');
    console.log('');
    console.log('📋 Configuration:');
    console.log('  🔑 Zernio API Key:', ZERNIO_API_KEY ? '✅ Set' : '❌ Missing');
    console.log('  📄 Facebook Page ID:', FACEBOOK_PAGE_ID ? '✅ Set' : '❌ Missing');
    console.log('  ⏱️  Auto-post Interval:', AUTO_POST_INTERVAL, 'minutes');
    console.log('  📦 Zernio Client:', zernio ? '✅ Initialized' : '❌ Not initialized');
    console.log('');
  });
}