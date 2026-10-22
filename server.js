const axios = require('axios');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ffmpeg sirf audio feature ke liye hai — agar package na ho to baqi server phir bhi chale ga
let ffmpegPath = null;
try { ffmpegPath = require('ffmpeg-static'); } catch (e) { ffmpegPath = null; }

async function getSnackVideoData(videoLink) {
  if (!videoLink || !videoLink.includes('snackvideo.com')) {
    throw new Error('This is not a valid Snack Video link. The link must be from snackvideo.com.');
  }
  const photoId = videoLink.match(/video\/(\d+)/)?.[1];
  if (!photoId) {
    throw new Error('No video ID found in the link. Please paste a correct Snack Video link.');
  }
  let html;
  try {
    const response = await axios.get(videoLink, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15' },
      timeout: 10000
    });
    html = response.data;
  } catch (err) {
    throw new Error('The video page could not be loaded. The link may be wrong, or the video may be private or deleted.');
  }
  const clean = html.replace(/\\"/g, '"');

  // NAYA tareeqa: page ke VideoObject schema me contentUrl + thumbnailUrl
  const videoMatch = clean.match(/"contentUrl":"(https:[^"]+?\.mp4[^"]*)"/);
  if (videoMatch) {
    const thumbMatch = clean.match(/"thumbnailUrl":\["([^"]+)"/);
    return {
      thumbnail: thumbMatch ? thumbMatch[1] : null,
      qualities: [{ label: 'Download Video', url: videoMatch[1], codec: 'mp4' }]
    };
  }

  // PURANA tareeqa (fallback, agar kabhi purana structure wapas aaye)
  const blockRegex = new RegExp(`"photo_id_str":"${photoId}"[\\s\\S]{0,8000}`);
  const blockMatch = clean.match(blockRegex);
  if (!blockMatch) {
    throw new Error('Video not found. It may have been deleted or made private.');
  }
  const block = blockMatch[0];
  const thumbMatch2 = block.match(/"cover_thumbnail_urls":\[\{"cdn":"[^"]+","url":"([^"]+)"/);
  const thumbnail = thumbMatch2 ? thumbMatch2[1] : null;
  const qualityRegex = /"url":"([^"]+\.mp4[^"]*)","backupUrl":\[[^\]]*\],"maxBitrate":(\d+),"avgBitrate":(\d+),"videoCodec":"([^"]+)"/g;
  const qualities = [];
  let qMatch;
  while ((qMatch = qualityRegex.exec(block)) !== null) {
    qualities.push({ url: qMatch[1], avgBitrate: parseInt(qMatch[3]), codec: qMatch[4] });
  }
  if (qualities.length === 0) {
    const fallback = block.match(/"main_mv_urls":\[\{"cdn":"[^"]+","url":"([^"]+)"/);
    if (fallback) qualities.push({ url: fallback[1], avgBitrate: 0, codec: 'default' });
    if (qualities.length === 0) throw new Error('Video URL not found. This video cannot be downloaded.');
  }
  qualities.sort((a, b) => b.avgBitrate - a.avgBitrate);
  const labeledQualities = qualities.map((q, index) => ({
    label: index === 0 ? 'High Quality' : 'Standard Quality',
    url: q.url,
    codec: q.codec
  }));
  return { thumbnail, qualities: labeledQualities };
}

app.post('/api/download', async (req, res) => {
  try {
    const result = await getSnackVideoData(req.body.link);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Audio (MP3) download — video se sirf awaz nikaal kar MP3 bana kar deta hai
app.post('/api/audio', async (req, res) => {
  if (!ffmpegPath) {
    return res.status(500).json({ success: false, error: 'Audio download is not enabled on this server yet.' });
  }
  const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const inFile = path.join(os.tmpdir(), 'svd-' + id + '.mp4');
  const outFile = path.join(os.tmpdir(), 'svd-' + id + '.mp3');
  const cleanup = () => { fs.unlink(inFile, () => {}); fs.unlink(outFile, () => {}); };
  try {
    const data = await getSnackVideoData(req.body.link);
    const videoUrl = data.qualities[0].url;

    // Video file download karo (stream, taake memory pe bojh na pare)
    const response = await axios.get(videoUrl, { responseType: 'stream', timeout: 60000 });
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(inFile);
      response.data.pipe(ws);
      ws.on('finish', resolve);
      ws.on('error', reject);
      response.data.on('error', reject);
    });

    // ffmpeg se MP3 banao
    await new Promise((resolve, reject) => {
      execFile(ffmpegPath, ['-y', '-i', inFile, '-vn', '-codec:a', 'libmp3lame', '-q:a', '2', outFile],
        (err) => (err ? reject(err) : resolve()));
    });

    res.download(outFile, 'snack-audio.mp3', cleanup);
  } catch (err) {
    cleanup();
    res.status(400).json({ success: false, error: 'Audio could not be extracted from this video.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server is running: http://localhost:' + PORT);
});
